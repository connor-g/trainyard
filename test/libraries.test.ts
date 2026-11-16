import "fake-indexeddb/auto";
import { describe, expect, test } from "vite-plus/test";
import {
  DEFAULT_LIBRARY,
  YardLibrary,
  activeLibrary,
  addLibrary,
  openStorage,
  readLibraries,
  removeLibrary,
  setActiveLibrary,
  yardBlobKey,
} from "../src/libraries.ts";
import type { SettingsStore } from "../src/libraries.ts";
import { toSaved } from "../src/saves.ts";
import { IdbStorage } from "../src/storage/idb-storage.ts";
import { S3Storage } from "../src/storage/s3-storage.ts";
import { sampleLayout } from "../src/presets.ts";

function memorySettings(initial: Record<string, string> = {}): SettingsStore & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

let databases = 0;
const localLibrary = () =>
  new YardLibrary({ ...DEFAULT_LIBRARY, databaseName: `libraries-${(databases += 1)}` });

const s3 = {
  kind: "s3",
  name: "Family",
  bucketUrl: "https://example-bucket.s3.us-east-1.amazonaws.com",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret",
} as const;

describe("library settings", () => {
  test("the local library is the default, and is always first", () => {
    const settings = memorySettings();
    expect(readLibraries(settings)).toEqual([DEFAULT_LIBRARY]);
    expect(activeLibrary(settings)).toEqual(DEFAULT_LIBRARY);
  });

  test("adds, chooses and removes an S3 library", () => {
    const settings = memorySettings();
    const added = addLibrary(settings, s3);
    expect(readLibraries(settings)).toEqual([DEFAULT_LIBRARY, added]);
    setActiveLibrary(settings, added.id);
    expect(activeLibrary(settings)).toEqual(added);
    removeLibrary(settings, added.id);
    expect(readLibraries(settings)).toEqual([DEFAULT_LIBRARY]);
    expect(activeLibrary(settings)).toEqual(DEFAULT_LIBRARY);
  });

  test("refuses incomplete S3 settings", () => {
    expect(() => addLibrary(memorySettings(), { ...s3, bucketUrl: "not a url" })).toThrow(
      TypeError,
    );
    expect(() => addLibrary(memorySettings(), { ...s3, secretAccessKey: "" })).toThrow(TypeError);
  });

  test("drops unreadable entries and falls back from a missing active library", () => {
    const settings = memorySettings({
      "rail-yard-libraries-v1": JSON.stringify([{ kind: "s3", id: "x" }, { kind: "ftp" }]),
      "rail-yard-active-library": "gone",
    });
    expect(readLibraries(settings)).toEqual([DEFAULT_LIBRARY]);
    expect(activeLibrary(settings)).toEqual(DEFAULT_LIBRARY);
    expect(readLibraries(memorySettings({ "rail-yard-libraries-v1": "{" }))).toEqual([
      DEFAULT_LIBRARY,
    ]);
  });

  test("opens IndexedDB for the local library and S3 for a bucket", () => {
    expect(openStorage(DEFAULT_LIBRARY)).toBeInstanceOf(IdbStorage);
    expect(openStorage({ ...s3, id: "family" })).toBeInstanceOf(S3Storage);
  });
});

describe("yard library", () => {
  test("saves, lists, replaces by name and deletes yards", async () => {
    const library = localLibrary();
    const yard = sampleLayout();
    await library.save({ ...yard, name: "Mine" });
    await library.save({ ...yard, name: "MINE", background: "desert" });
    const listed = await library.list();
    expect(listed.map(({ name, background }) => ({ name, background }))).toEqual([
      { name: "MINE", background: "desert" },
    ]);
    expect(toSaved(listed[0]).grid).toEqual(toSaved(yard).grid);
    await library.delete("mine");
    expect(await library.list()).toEqual([]);
  });

  test("skips blobs that aren't playable yards", async () => {
    const library = localLibrary();
    await library.storage.create(yardBlobKey("broken"), new Blob(["{"]));
    await library.storage.create(yardBlobKey("odd"), new Blob(['{"name":"Odd"}']));
    await library.storage.create("notes.txt", new Blob(["hello"]));
    await library.save(sampleLayout());
    expect((await library.list()).map((yard) => yard.name)).toEqual([sampleLayout().name]);
  });
});
