/** Stores blobs in an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, ...) with signed requests. */
import { Sha256 } from "@aws-crypto/sha256-js";
import { SignatureV4 } from "@smithy/signature-v4";

import { BlobExistsError, BlobNotFoundError, assertKey } from "./blob-storage.ts";
import type { BlobInfo, BlobStorage } from "./blob-storage.ts";

export interface S3StorageOptions {
  /**
   * The bucket's base URL, path-style or virtual-hosted, such as
   * `https://my-bucket.s3.us-east-1.amazonaws.com` or `http://nas.local:9000/my-bucket`.
   */
  readonly bucketUrl: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  /** Defaults to the region in the URL; R2 uses "auto". */
  readonly region?: string;
  /** Prepended to every key, so several stores can share a bucket. */
  readonly keyPrefix?: string;
  /**
   * How long each request may take, in milliseconds, before it fails with a `TimeoutError`.
   * Defaults to 15 seconds, so a bucket that never answers can't leave the page waiting.
   */
  readonly timeoutMs?: number;
}

export class S3StorageError extends Error {
  readonly status: number;
  constructor(action: string, response: Response) {
    super(`S3 ${action} failed with ${response.status} ${response.statusText}`);
    this.name = "S3StorageError";
    this.status = response.status;
  }
}

/** How many times `update` retries when the blob changes between reading its ETag and writing. */
const UPDATE_ATTEMPTS = 3;

const DEFAULT_TIMEOUT_MS = 15_000;

const MAX_RETRIES = 10;

function bucketRegion(hostname: string): string {
  if (hostname.endsWith(".r2.cloudflarestorage.com")) return "auto";
  const aws =
    /(?:^|\.)s3(?:-fips)?[.-](?:dualstack\.)?([a-z]+(?:-[a-z]+)+-\d+)\.amazonaws\.com(?:\.cn)?$/;
  const backblaze = /(?:^|\.)s3\.([^.]+)\.backblazeb2\.com$/;
  return aws.exec(hostname)?.[1] ?? backblaze.exec(hostname)?.[1] ?? "us-east-1";
}

const escapeS3Path = (path: string) =>
  path.replace(/[!'()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase());

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decodeXml = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return XML_ENTITIES[entity] ?? match;
    const code =
      entity[1] === "x" || entity[1] === "X"
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
    return String.fromCodePoint(code);
  });

const xmlValue = (xml: string, tag: string) => {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? decodeXml(match[1]) : undefined;
};

/** Reads one page of a ListObjectsV2 response. The format is fixed and simple enough not to need a full XML parser. */
export function parseListPage(xml: string): {
  objects: { key: string; size: number; lastModified: number }[];
  nextToken?: string;
} {
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, contents]) => ({
    key: xmlValue(contents, "Key") ?? "",
    size: Number(xmlValue(contents, "Size") ?? 0),
    lastModified: Date.parse(xmlValue(contents, "LastModified") ?? ""),
  }));
  const truncated = xmlValue(xml, "IsTruncated") === "true";
  const nextToken = truncated ? xmlValue(xml, "NextContinuationToken") : undefined;
  return nextToken ? { objects, nextToken } : { objects };
}

export class S3Storage implements BlobStorage {
  readonly #base: string;
  readonly #keyPrefix: string;
  readonly #timeoutMs: number;
  readonly #signer: SignatureV4;

  constructor(options: S3StorageOptions) {
    this.#base = options.bucketUrl.replace(/\/+$/, "");
    this.#keyPrefix = options.keyPrefix ?? "";
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#signer = new SignatureV4({
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        ...(options.sessionToken && { sessionToken: options.sessionToken }),
      },
      service: "s3",
      region: options.region || bucketRegion(new URL(this.#base).hostname),
      // The JavaScript implementation also works on plain HTTP, where crypto.subtle is unavailable.
      sha256: Sha256,
      uriEscapePath: false,
    });
  }

  async list(): Promise<BlobInfo[]> {
    const results: BlobInfo[] = [];
    let token: string | undefined;
    do {
      const url = new URL(`${this.#base}/`);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", this.#keyPrefix);
      if (token) url.searchParams.set("continuation-token", token);
      const response = await this.#fetch(url);
      if (!response.ok) throw new S3StorageError("list", response);
      const page = parseListPage(await response.text());
      for (const object of page.objects) {
        results.push({ ...object, key: object.key.slice(this.#keyPrefix.length) });
      }
      token = page.nextToken;
    } while (token);
    return results;
  }

  async create(key: string, data: Blob): Promise<void> {
    assertKey(key);
    // A conditional write, so two creates of the same key can't both succeed.
    const response = await this.#put(key, data, { "If-None-Match": "*" });
    if (response.status === 412) throw new BlobExistsError(key);
    if (!response.ok) throw new S3StorageError("create", response);
  }

  async read(key: string): Promise<Blob | null> {
    assertKey(key);
    const response = await this.#fetch(this.#objectUrl(key));
    if (response.status === 404) return null;
    if (!response.ok) throw new S3StorageError("read", response);
    return response.blob();
  }

  async update(key: string, data: Blob): Promise<void> {
    assertKey(key);
    for (let attempt = 0; attempt < UPDATE_ATTEMPTS; attempt += 1) {
      const head = await this.#fetch(this.#objectUrl(key), { method: "HEAD" });
      if (head.status === 404) throw new BlobNotFoundError(key);
      if (!head.ok) throw new S3StorageError("update", head);
      const etag = head.headers.get("ETag");
      // Write only over the version just seen, so a concurrent delete isn't silently undone.
      const response = await this.#put(key, data, etag ? { "If-Match": etag } : {});
      if (response.status === 404) throw new BlobNotFoundError(key);
      if (response.status === 412) continue;
      if (!response.ok) throw new S3StorageError("update", response);
      return;
    }
    throw new Error(`Gave up updating "${key}" after it kept changing`);
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    const response = await this.#fetch(this.#objectUrl(key), { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new S3StorageError("delete", response);
  }

  /** A signed request that gives up after the timeout, including while its body is read. */
  async #fetch(
    input: string | URL,
    {
      method = "GET",
      headers = {},
      body,
    }: { method?: string; headers?: Record<string, string>; body?: ArrayBuffer } = {},
  ): Promise<Response> {
    const url = new URL(input);
    url.pathname = escapeS3Path(url.pathname);
    const request = {
      method,
      protocol: url.protocol,
      hostname: url.hostname,
      ...(url.port && { port: Number(url.port) }),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: { ...headers, host: url.host },
      body,
    };
    const signal = AbortSignal.timeout(this.#timeoutMs);
    const signed = await this.#signer.sign(request);
    // Host must be signed including the port, but only the browser is allowed to send it.
    delete signed.headers.host;
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(url, { method, headers: signed.headers, body, signal });
      if (attempt >= MAX_RETRIES || (response.status < 500 && response.status !== 429)) {
        return response;
      }
      await response.body?.cancel();
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(this.#timeoutMs, Math.random() * 50 * 2 ** attempt)),
      );
    }
  }

  #objectUrl(key: string): string {
    const path = (this.#keyPrefix + key).split("/").map(encodeURIComponent).join("/");
    return `${this.#base}/${path}`;
  }

  async #put(key: string, data: Blob, condition: Record<string, string>): Promise<Response> {
    return this.#fetch(this.#objectUrl(key), {
      method: "PUT",
      // The signer hashes the payload, which needs the bytes up front.
      body: await data.arrayBuffer(),
      headers: { "Content-Type": data.type || "application/octet-stream", ...condition },
    });
  }
}
