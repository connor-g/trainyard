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

export function createIdbStorage({
  databaseName = "trainyard-blobs",
}: IdbStorageOptions = {}): BlobStorage & {
  /** Closes the database connection. The storage can't be used afterwards. */
  close(): Promise<void>;
} {
  let db: Promise<IDBPDatabase<BlobSchema>> | undefined;
  const open = () =>
    (db ??= openDB<BlobSchema>(databaseName, 1, {
      upgrade(database) {
        database.createObjectStore(STORE, { keyPath: "key" });
      },
    }));

  return {
    async list() {
      const records = await (await open()).getAll(STORE);
      return records.map(toInfo);
    },

    async create(key, data) {
      assertKey(key);
      try {
        await (await open()).add(STORE, record(key, data));
      } catch (error) {
        if (error instanceof DOMException && error.name === "ConstraintError") {
          throw new BlobExistsError(key);
        }
        throw error;
      }
    },

    async read(key) {
      assertKey(key);
      return (await (await open()).get(STORE, key))?.data ?? null;
    },

    async update(key, data) {
      assertKey(key);
      const tx = (await open()).transaction(STORE, "readwrite");
      // Check and write in one transaction so a concurrent delete can't slip between them.
      if ((await tx.store.getKey(key)) === undefined) {
        tx.abort();
        await tx.done.catch(() => {});
        throw new BlobNotFoundError(key);
      }
      await Promise.all([tx.store.put(record(key, data)), tx.done]);
    },

    async delete(key) {
      assertKey(key);
      await (await open()).delete(STORE, key);
    },

    async close() {
      if (db) (await db).close();
      db = undefined;
    },
  };
}
