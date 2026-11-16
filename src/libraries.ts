/**
 * Storage libraries: places where saved yards live. Each library is backed by a `BlobStorage`, either
 * IndexedDB on this device (the default, always present) or an S3-compatible bucket the player adds.
 */

import { isRecord } from "./guards.ts";
import { parseSaved } from "./saves.ts";
import type { SavedYard } from "./saves.ts";
import type { BlobStorage } from "./storage/blob-storage.ts";
import { BlobExistsError, BlobNotFoundError } from "./storage/blob-storage.ts";
import { IdbStorage } from "./storage/idb-storage.ts";
import { S3Storage } from "./storage/s3-storage.ts";

export interface LocalLibrarySettings {
  readonly id: string;
  readonly kind: "local";
  readonly name: string;
  /** The IndexedDB database to use. Defaults to the storage's own default. */
  readonly databaseName?: string;
}

export interface S3LibrarySettings {
  readonly id: string;
  readonly kind: "s3";
  readonly name: string;
  readonly bucketUrl: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly region?: string;
  readonly keyPrefix?: string;
}

export type LibrarySettings = LocalLibrarySettings | S3LibrarySettings;

export type NewLibrary = Omit<LocalLibrarySettings, "id"> | Omit<S3LibrarySettings, "id">;

/** The library on this device. It can't be removed, and is used whenever no other is chosen. */
export const DEFAULT_LIBRARY: LocalLibrarySettings = {
  id: "local",
  kind: "local",
  name: "This device",
};

const YARD_PREFIX = "yards/";
const YARD_SUFFIX = ".json";

/** Yards are keyed by their name, ignoring case, so saving under an existing name replaces it. */
export const yardNameKey = (name: string): string => name.toLowerCase();

export const yardBlobKey = (name: string): string => YARD_PREFIX + yardNameKey(name) + YARD_SUFFIX;

/** Reads and writes saved yards in one library's blob storage. */
export class YardLibrary {
  readonly settings: LibrarySettings;
  readonly storage: BlobStorage;

  constructor(settings: LibrarySettings, storage: BlobStorage = openStorage(settings)) {
    this.settings = settings;
    this.storage = storage;
  }

  /**
   * Lists the playable yards, skipping any blob that isn't one. A yard whose name doesn't match its
   * key is skipped too: saving or deleting it by name would reach a different blob.
   */
  async list(): Promise<SavedYard[]> {
    const keys = (await this.storage.list())
      .map((info) => info.key)
      .filter((key) => key.startsWith(YARD_PREFIX) && key.endsWith(YARD_SUFFIX));
    const yards = await Promise.all(keys.map((key) => this.#read(key)));
    return yards.filter(
      (yard, i): yard is SavedYard => yard !== null && yardBlobKey(yard.name) === keys[i],
    );
  }

  /** Saves the yard under its name, replacing a saved yard with the same name. */
  async save(yard: SavedYard): Promise<void> {
    const key = yardBlobKey(yard.name);
    const data = new Blob([JSON.stringify(yard)], { type: "application/json" });
    // Try the likelier write first, and fall back if another device got there in between.
    try {
      await this.storage.create(key, data);
    } catch (error) {
      if (!(error instanceof BlobExistsError)) throw error;
      try {
        await this.storage.update(key, data);
      } catch (retry) {
        if (!(retry instanceof BlobNotFoundError)) throw retry;
        await this.storage.create(key, data);
      }
    }
  }

  async delete(name: string): Promise<void> {
    await this.storage.delete(yardBlobKey(name));
  }

  async #read(key: string): Promise<SavedYard | null> {
    try {
      const blob = await this.storage.read(key);
      return blob ? parseSaved(JSON.parse(await blob.text())) : null;
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }
}

export function openStorage(settings: LibrarySettings): BlobStorage {
  if (settings.kind === "local") {
    return new IdbStorage(settings.databaseName ? { databaseName: settings.databaseName } : {});
  }
  const { bucketUrl, accessKeyId, secretAccessKey, sessionToken, region, keyPrefix } = settings;
  return new S3Storage({
    bucketUrl,
    accessKeyId,
    secretAccessKey,
    ...(sessionToken && { sessionToken }),
    ...(region && { region }),
    ...(keyPrefix && { keyPrefix }),
  });
}

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value !== "";

const optional = (value: unknown) => value === undefined || typeof value === "string";

function isLibrarySettings(value: unknown): value is LibrarySettings {
  if (!isRecord(value) || !nonEmpty(value.id) || !nonEmpty(value.name)) return false;
  if (value.kind === "local") return optional(value.databaseName);
  return (
    value.kind === "s3" &&
    nonEmpty(value.bucketUrl) &&
    URL.canParse(value.bucketUrl) &&
    nonEmpty(value.accessKeyId) &&
    nonEmpty(value.secretAccessKey) &&
    [value.sessionToken, value.region, value.keyPrefix].every(optional)
  );
}

/** Where library settings are kept: `localStorage` in the app, anything with the same shape in tests. */
export type SettingsStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const LIBRARIES_KEY = "rail-yard-libraries-v1";
const ACTIVE_KEY = "rail-yard-active-library";

/** Reads the libraries, always with the default first. Unreadable entries are dropped. */
export function readLibraries(settings: SettingsStore): LibrarySettings[] {
  let stored: unknown = [];
  try {
    stored = JSON.parse(settings.getItem(LIBRARIES_KEY) ?? "[]");
  } catch {}
  const added = Array.isArray(stored)
    ? stored.filter(isLibrarySettings).filter((library) => library.id !== DEFAULT_LIBRARY.id)
    : [];
  return [DEFAULT_LIBRARY, ...added];
}

/** Writes the libraries the player added. The default is implied and never written. */
export function writeLibraries(
  settings: SettingsStore,
  libraries: readonly LibrarySettings[],
): void {
  const added = libraries.filter((library) => library.id !== DEFAULT_LIBRARY.id);
  settings.setItem(LIBRARIES_KEY, JSON.stringify(added));
}

/** Returns the chosen library, or the default if none is chosen or the chosen one is gone. */
export function activeLibrary(
  settings: SettingsStore,
  libraries: readonly LibrarySettings[] = readLibraries(settings),
): LibrarySettings {
  const id = settings.getItem(ACTIVE_KEY);
  return libraries.find((library) => library.id === id) ?? DEFAULT_LIBRARY;
}

export function setActiveLibrary(settings: SettingsStore, id: string): void {
  if (id === DEFAULT_LIBRARY.id) settings.removeItem(ACTIVE_KEY);
  else settings.setItem(ACTIVE_KEY, id);
}

/** Adds a library, giving it a fresh id, and returns its settings. */
export function addLibrary(settings: SettingsStore, library: NewLibrary): LibrarySettings {
  const added: unknown = { ...library, id: crypto.randomUUID() };
  if (!isLibrarySettings(added)) throw new TypeError("These library settings are incomplete");
  writeLibraries(settings, [...readLibraries(settings), added]);
  return added;
}

/** Removes a library the player added. Its yards stay where they are. */
export function removeLibrary(settings: SettingsStore, id: string): void {
  writeLibraries(
    settings,
    readLibraries(settings).filter((library) => library.id !== id),
  );
  if (settings.getItem(ACTIVE_KEY) === id) settings.removeItem(ACTIVE_KEY);
}
