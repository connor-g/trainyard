/** Stores blobs in the browser with IndexedDB, so they stay on this device and browser. */
import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";

import { BlobExistsError, BlobNotFoundError, assertKey } from "./blob-storage.ts";
import type { BlobInfo, BlobStorage } from "./blob-storage.ts";

interface StoredBlob extends BlobInfo {
  readonly data: Blob;
}

interface BlobSchema extends DBSchema {
  blobs: { key: string; value: StoredBlob };
}

const STORE = "blobs";

export interface IdbStorageOptions {
  /** The IndexedDB database to use. Defaults to "trainyard-blobs". */
  readonly databaseName?: string;
}

const toInfo = ({ key, size, lastModified }: StoredBlob): BlobInfo => ({ key, size, lastModified });

const record = (key: string, data: Blob): StoredBlob => ({
  key,
  size: data.size,
  lastModified: Date.now(),
  data,
});

export class IdbStorage implements BlobStorage {
  readonly #databaseName: string;
  #db: Promise<IDBPDatabase<BlobSchema>> | undefined;

  constructor({ databaseName = "trainyard-blobs" }: IdbStorageOptions = {}) {
    this.#databaseName = databaseName;
  }

  /** Opens the database on first use and reuses the connection after that. */
  #open(): Promise<IDBPDatabase<BlobSchema>> {
    return (this.#db ??= openDB<BlobSchema>(this.#databaseName, 1, {
      upgrade(database) {
        database.createObjectStore(STORE, { keyPath: "key" });
      },
    }));
  }

  async list(): Promise<BlobInfo[]> {
    const records = await (await this.#open()).getAll(STORE);
    return records.map(toInfo);
  }

  async create(key: string, data: Blob): Promise<void> {
    assertKey(key);
    try {
      await (await this.#open()).add(STORE, record(key, data));
    } catch (error) {
      if (error instanceof DOMException && error.name === "ConstraintError") {
        throw new BlobExistsError(key);
      }
      throw error;
    }
  }

  async read(key: string): Promise<Blob | null> {
    assertKey(key);
    return (await (await this.#open()).get(STORE, key))?.data ?? null;
  }

  async update(key: string, data: Blob): Promise<void> {
    assertKey(key);
    const tx = (await this.#open()).transaction(STORE, "readwrite");
    // Check and write in one transaction so a concurrent delete can't slip between them.
    if ((await tx.store.getKey(key)) === undefined) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new BlobNotFoundError(key);
    }
    await Promise.all([tx.store.put(record(key, data)), tx.done]);
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await (await this.#open()).delete(STORE, key);
  }

  /** Closes the database connection. Using the storage again reopens it. */
  async close(): Promise<void> {
    const db = this.#db;
    this.#db = undefined;
    if (db) (await db).close();
  }
}
