/** A key-value store for blobs, with a local (IndexedDB) and a remote (S3-compatible) implementation. */

export interface BlobInfo {
  readonly key: string;
  /** In bytes. */
  readonly size: number;
  /** Milliseconds since the epoch. */
  readonly lastModified: number;
}

export interface BlobStorage {
  /** Lists the stored blobs in key order. */
  list(): Promise<BlobInfo[]>;

  /** Stores a new blob. Rejects with `BlobExistsError` if the key is taken. */
  create(key: string, data: Blob): Promise<void>;

  /** Returns the blob, or null if there is none under the key. */
  read(key: string): Promise<Blob | null>;

  /** Replaces an existing blob. Rejects with `BlobNotFoundError` if there is none under the key. */
  update(key: string, data: Blob): Promise<void>;

  /** Removes the blob. Succeeds whether or not one was stored. */
  delete(key: string): Promise<void>;
}

export class BlobExistsError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`A blob already exists under "${key}"`);
    this.name = "BlobExistsError";
    this.key = key;
  }
}

export class BlobNotFoundError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`No blob exists under "${key}"`);
    this.name = "BlobNotFoundError";
    this.key = key;
  }
}

export function assertKey(key: string): void {
  if (typeof key !== "string" || key.length === 0)
    throw new TypeError("A blob key must be a non-empty string");
}
