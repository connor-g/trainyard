import "fake-indexeddb/auto";
import { http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";

import { BlobExistsError, BlobNotFoundError } from "../src/storage/blob-storage.ts";
import type { BlobStorage } from "../src/storage/blob-storage.ts";
import { IdbStorage } from "../src/storage/idb-storage.ts";
import { S3Storage, parseListPage } from "../src/storage/s3-storage.ts";

const text = (value: string, type = "text/plain") => new Blob([value], { type });

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * An in-memory S3 bucket that answers the requests the storage makes, including conditional writes.
 * `intercept` runs before each request, so a test can change the bucket underneath the storage.
 */
function fakeBucket(bucketUrl: string, intercept?: (request: Request) => void) {
  const objects = new Map<
    string,
    { body: ArrayBuffer; type: string; etag: string; modified: Date }
  >();
  let version = 0;
  const requests: Request[] = [];
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const handle = async (request: Request): Promise<Response> => {
    requests.push(request);
    const url = new URL(request.url);
    const path = url.pathname.slice(new URL(bucketUrl).pathname.replace(/\/$/, "").length + 1);
    const key = path.split("/").map(decodeURIComponent).join("/");
    const existing = objects.get(key);

    if (request.method === "GET" && key === "") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(url.searchParams.get("continuation-token") ?? 0);
      const page = keys.slice(start, start + 2);
      const more = start + 2 < keys.length;
      const contents = page
        .map((k) => {
          const object = objects.get(k)!;
          return `<Contents><Key>${escape(k)}</Key><LastModified>${object.modified.toISOString()}</LastModified><Size>${object.body.byteLength}</Size></Contents>`;
        })
        .join("");
      const body = `<?xml version="1.0"?><ListBucketResult><IsTruncated>${more}</IsTruncated>${contents}${more ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ""}</ListBucketResult>`;
      return new Response(body, { headers: { "Content-Type": "application/xml" } });
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (!existing) return new Response(null, { status: 404 });
      const headers = { "Content-Type": existing.type, ETag: existing.etag };
      return new Response(request.method === "GET" ? existing.body : null, { headers });
    }
    if (request.method === "PUT") {
      if (request.headers.get("If-None-Match") === "*" && existing) {
        return new Response(null, { status: 412 });
      }
      const ifMatch = request.headers.get("If-Match");
      if (ifMatch && !existing) return new Response(null, { status: 404 });
      if (ifMatch && existing!.etag !== ifMatch) return new Response(null, { status: 412 });
      version += 1;
      objects.set(key, {
        body: await request.arrayBuffer(),
        type: request.headers.get("Content-Type") ?? "",
        etag: `"${version}"`,
        modified: new Date(),
      });
      return new Response(null, { status: 200 });
    }
    if (request.method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };

  const base = bucketUrl.replace(/\/$/, "");
  const resolver = ({ request }: { request: Request }) => {
    intercept?.(request);
    return handle(request);
  };
  server.use(http.all(`${base}/`, resolver), http.all(`${base}/*`, resolver));
  return { objects, requests };
}

function contract(
  name: string,
  setup: () => { storage: BlobStorage; teardown?: () => Promise<void> },
) {
  describe(name, () => {
    let storage: BlobStorage;
    let teardown: (() => Promise<void>) | undefined;
    beforeEach(() => ({ storage, teardown } = setup()));
    afterEach(async () => teardown?.());

    test("creates and reads a blob, keeping its bytes and type", async () => {
      await storage.create("yards/meadow.json", text('{"a":1}', "application/json"));
      const blob = await storage.read("yards/meadow.json");
      expect(await blob?.text()).toBe('{"a":1}');
      expect(blob?.type).toBe("application/json");
    });

    test("reads null for a missing key", async () => {
      expect(await storage.read("missing")).toBeNull();
    });

    test("refuses to create over an existing blob", async () => {
      await storage.create("a", text("one"));
      await expect(storage.create("a", text("two"))).rejects.toBeInstanceOf(BlobExistsError);
      expect(await (await storage.read("a"))?.text()).toBe("one");
    });

    test("updates an existing blob and refuses to update a missing one", async () => {
      await storage.create("a", text("one"));
      await storage.update("a", text("two!"));
      expect(await (await storage.read("a"))?.text()).toBe("two!");
      await expect(storage.update("b", text("x"))).rejects.toBeInstanceOf(BlobNotFoundError);
      expect(await storage.read("b")).toBeNull();
    });

    test("deletes a blob, and deleting a missing one succeeds", async () => {
      await storage.create("a", text("one"));
      await storage.delete("a");
      expect(await storage.read("a")).toBeNull();
      await storage.delete("a");
    });

    test("lists blobs in key order", async () => {
      for (const key of ["yards/b", "sounds/horn", "yards/a & c", "yards/c"]) {
        await storage.create(key, text(key));
      }
      const all = await storage.list();
      expect(all.map((info) => info.key)).toEqual([
        "sounds/horn",
        "yards/a & c",
        "yards/b",
        "yards/c",
      ]);
      expect(all[0].size).toBe("sounds/horn".length);
      expect(all[0].lastModified).toBeGreaterThan(0);
    });

    test("rejects an empty key", async () => {
      await expect(storage.read("")).rejects.toThrow(TypeError);
    });
  });
}

let databases = 0;
contract("IndexedDB storage", () => {
  const storage = new IdbStorage({ databaseName: `test-${(databases += 1)}` });
  return { storage, teardown: () => storage.close() };
});

contract("S3 storage", () => {
  const bucketUrl = "https://example-bucket.s3.us-east-1.amazonaws.com";
  fakeBucket(bucketUrl);
  const storage = new S3Storage({
    bucketUrl,
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret",
    region: "us-east-1",
  });
  return { storage };
});

describe("S3 storage requests", () => {
  test("signs requests and keeps keys under the key prefix", async () => {
    const bucketUrl = "https://account.r2.cloudflarestorage.com/bucket/";
    const bucket = fakeBucket(bucketUrl);
    const storage = new S3Storage({
      bucketUrl,
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret",
      region: "auto",
      keyPrefix: "trainyard/",
    });
    await storage.create("my yard?.json", text("{}"));
    expect([...bucket.objects.keys()]).toEqual(["trainyard/my yard?.json"]);
    expect(bucket.requests[0].url).toBe(
      "https://account.r2.cloudflarestorage.com/bucket/trainyard/my%20yard%3F.json",
    );
    expect(bucket.requests[0].headers.get("Authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
    expect((await storage.list()).map((info) => info.key)).toEqual(["my yard?.json"]);
  });

  test("update retries when the blob changes between reading and writing", async () => {
    const bucketUrl = "https://example-bucket.s3.us-east-1.amazonaws.com";
    let raced = false;
    const bucket = fakeBucket(bucketUrl, (request) => {
      if (request.method === "PUT" && request.headers.has("If-Match") && !raced) {
        raced = true;
        const object = bucket.objects.get("a")!;
        bucket.objects.set("a", { ...object, etag: '"elsewhere"' });
      }
    });
    const storage = new S3Storage({ bucketUrl, accessKeyId: "id", secretAccessKey: "secret" });
    await storage.create("a", text("one"));
    await storage.update("a", text("two"));
    expect(raced).toBe(true);
    expect(await (await storage.read("a"))?.text()).toBe("two");
  });

  test("parses entities and continuation tokens in list pages", () => {
    const page = parseListPage(
      "<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>a &amp; &#98;</Key><Size>3</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents><NextContinuationToken>t&lt;1</NextContinuationToken></ListBucketResult>",
    );
    expect(page).toEqual({
      objects: [{ key: "a & b", size: 3, lastModified: Date.UTC(2026, 0, 1) }],
      nextToken: "t<1",
    });
  });
});
