import { describe, expect, test } from "vite-plus/test";

import { sampleLayout, scenicPresets } from "../src/presets.ts";
import { blankSaved, fromSaved, parseSaved, toSaved } from "../src/saves.ts";
import type { SavedYard } from "../src/saves.ts";
import { createStore } from "../src/store.ts";

/** Saves go through JSON, so tests read them back the same way. */
const throughJson = (saved: SavedYard): unknown => JSON.parse(JSON.stringify(saved));

describe("saves", () => {
  test("round-trip every built-in yard, with each train at its start", () => {
    for (const yard of [sampleLayout(), ...scenicPresets()]) {
      const saved = toSaved(yard);
      expect(parseSaved(throughJson(saved))).toEqual(saved);
      expect(toSaved(fromSaved(saved))).toEqual(saved);
    }
  });

  test("a blank yard is a playable save", () => {
    const blank = blankSaved("Empty", { cols: 9, rows: 7 }, "coast");
    expect(parseSaved(throughJson(blank))).toEqual(blank);
  });

  test("saving after trains have moved writes their start paths", () => {
    const store = createStore(sampleLayout());
    const before = toSaved(store.yard);
    for (let frame = 0; frame < 300; frame += 1) store.tick(1 / 60, 1);
    expect(toSaved(store.yard)).toEqual(before);
  });

  describe("reject anything that isn't a playable yard", () => {
    const saved = toSaved(sampleLayout());
    const [train] = saved.trains;
    const withTrain = (changes: object) => ({ ...saved, trains: [{ ...train, ...changes }] });
    const cases: [string, unknown][] = [
      ["not an object", null],
      ["an unknown size", { ...saved, rows: 12 }],
      ["an unknown background", { ...saved, background: "moon" }],
      ["an unknown car", withTrain({ cars: [{ type: "snowplow", color: "brick" }] })],
      // Cars are drawn in their color, so an unknown one would break drawing.
      ["an unknown color", withTrain({ cars: [{ type: "diesel", color: "neon" }] })],
      ["a train without an engine", withTrain({ cars: [{ type: "box", color: "brick" }] })],
      [
        "a start off the track",
        withTrain({ start: { ...train.start, path: [train.start.path[1]] } }),
      ],
      ["a start that isn't a number", withTrain({ start: { ...train.start, progress: "1" } })],
      [
        "a tile turned out of range",
        { ...saved, grid: saved.grid.map((tile) => tile && { ...tile, turn: 6 }) },
      ],
    ];
    for (const [name, value] of cases) {
      test(name, () => expect(parseSaved(value)).toBeNull());
    }
  });
});
