import { describe, expect, test } from "vite-plus/test";
import { COLS } from "../src/railway.ts";
import type { Car } from "../src/catalog.ts";
import { initialMotion, motionEquals } from "../src/model/motion.ts";
import { COLLISION } from "../src/model/train.ts";
import { carPositions } from "../src/model/queries.ts";
import type { TrainId, Yard } from "../src/model/types.ts";
import { sampleLayout, scenicPresets } from "../src/presets.ts";
import { createStore } from "../src/store.ts";
import type { Store } from "../src/store.ts";
import { at, centre, straightRow, yardWith } from "./helpers.ts";

const diesel: Car = { type: "diesel", color: "brick" };
const steam: Car = { type: "steam", color: "pine" };
const box: Car = { type: "box", color: "amber" };
const STEP = 1 / 60;

function run(store: Store, seconds: number) {
  for (let frame = 0; frame < Math.round(seconds / STEP); frame += 1) store.tick(STEP, 1);
}

const positions = (store: Store, id: TrainId) =>
  carPositions(store.yard, store.motion)
    .get(id)!
    .map(({ x, y }) => [x, y]);

const startPositions = (yard: Yard, id: TrainId) =>
  carPositions(yard, initialMotion(yard))
    .get(id)!
    .map(({ x, y }) => [x, y]);

function expectClose(actual: number[][], expected: number[][]) {
  expect(actual).toHaveLength(expected.length);
  for (const [i, [x, y]] of actual.entries()) {
    expect(x).toBeCloseTo(expected[i][0], 6);
    expect(y).toBeCloseTo(expected[i][1], 6);
  }
}

describe("store", () => {
  test("starts every train at its start and notifies on edits, not on ticks", () => {
    const store = createStore(sampleLayout());
    expect(motionEquals(store.motion, initialMotion(store.yard))).toBe(true);
    const changes: unknown[] = [];
    store.subscribe((change) => changes.push(change));
    run(store, 1);
    expect(changes).toHaveLength(0);
    expect(store.canUndo).toBe(false);
    store.dispatch({ type: "setBackground", background: "desert" });
    expect(changes).toHaveLength(1);
    expect(store.canUndo).toBe(true);
  });

  test("a refused edit changes nothing", () => {
    const store = createStore(sampleLayout());
    const { yard, motion } = store;
    expect(store.dispatch({ type: "removeTrack", at: at(0, 0) })).toEqual({
      ok: false,
      reason: "no-change",
    });
    expect(store.yard).toBe(yard);
    expect(store.motion).toBe(motion);
    expect(store.canUndo).toBe(false);
  });

  test("renaming isn't undoable, and undo keeps the new name", () => {
    const store = createStore(sampleLayout());
    store.dispatch({ type: "setBackground", background: "desert" });
    store.dispatch({ type: "rename", name: "Mine" });
    store.undo();
    expect(store.yard.name).toBe("Mine");
    expect(store.yard.background).toBe("meadow");
    expect(store.canUndo).toBe(false);
  });

  test("undo doesn't rewind train movement", () => {
    const store = createStore(sampleLayout());
    const [train] = store.yard.trains;
    store.dispatch({ type: "setBackground", background: "desert" });
    run(store, 3);
    const moved = positions(store, train.id);
    store.undo();
    expectClose(positions(store, train.id), moved);
  });

  test("undoing a coupling keeps the train where it is", () => {
    const store = createStore(sampleLayout());
    const [train] = store.yard.trains;
    run(store, 2);
    const [engine] = carPositions(store.yard, store.motion).get(train.id)!;
    const result = store.dispatch({
      type: "addCar",
      car: box,
      at: { index: engine.index, x: engine.x % 1, y: engine.y % 1 },
    });
    expect(result.ok).toBe(true);
    expect(store.yard.trains[0].cars).toHaveLength(4);
    run(store, 1);
    const coupled = positions(store, train.id);
    store.undo();
    expect(store.yard.trains[0].cars).toHaveLength(3);
    expectClose(positions(store, train.id), coupled.slice(0, 3));
  });

  test("undoing a resize restores positions on the original board", () => {
    const store = createStore(sampleLayout());
    const [train] = store.yard.trains;
    run(store, 2);
    const before = positions(store, train.id);
    store.dispatch({ type: "resize", size: { cols: 12, rows: 9 } });
    const after = positions(store, train.id);
    const [dx, dy] = [after[0][0] - before[0][0], after[0][1] - before[0][1]];
    expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
    run(store, 1);
    const moved = positions(store, train.id);
    store.undo();
    expect(store.yard.board.cols).toBe(COLS);
    expectClose(
      positions(store, train.id),
      moved.map(([x, y]) => [x - dx, y - dy]),
    );
  });

  test("undoing a load doesn't carry positions across yards", () => {
    const store = createStore(sampleLayout());
    const meadow = store.yard;
    const [train] = meadow.trains;
    run(store, 3);
    store.dispatch({ type: "replace", yard: scenicPresets()[0] });
    expect(store.yard.trains.every((other) => other.id !== train.id)).toBe(true);
    run(store, 2);
    store.undo();
    expect(store.yard).toBe(meadow);
    expectClose(positions(store, train.id), startPositions(meadow, train.id));
  });

  test("undoing a train removal brings it back at its start", () => {
    const store = createStore(sampleLayout());
    const [train] = store.yard.trains;
    run(store, 3);
    store.dispatch({ type: "removeCar", car: { trainId: train.id, carIndex: 0 } });
    expect(store.yard.trains).toHaveLength(0);
    expect(store.motion.size).toBe(0);
    store.undo();
    expect(store.yard.trains).toEqual([train]);
    expectClose(positions(store, train.id), startPositions(store.yard, train.id));
  });

  test("undo that returns a train onto another holds it, visibly, until the other drives clear", () => {
    // A steam train ahead and a diesel five squares behind, both heading right.
    const store = createStore(yardWith(straightRow(1, 12, 5)));
    store.dispatch({ type: "addCar", car: steam, at: centre(8, 5) });
    store.dispatch({ type: "addCar", car: diesel, at: centre(3, 5) });
    const [steamTrain, dieselTrain] = store.yard.trains;
    const start = startPositions(store.yard, steamTrain.id);
    run(store, 1.5);
    // New track lets the steam train drive on to square 13.
    store.dispatch({ type: "placeTrack", at: at(13, 5), track: "straight" });
    run(store, 1.4);
    expect(positions(store, steamTrain.id)[0][0]).toBeGreaterThan(13);
    expect(Math.abs(positions(store, dieselTrain.id)[0][0] - start[0][0])).toBeLessThan(COLLISION);

    // Undo removes the track under the steam train, so it goes back to its start, on the diesel.
    store.undo();
    expect(store.motion.get(steamTrain.id)!.held).toBe(true);
    expectClose(positions(store, steamTrain.id), start);
    let releasedAt = -1;
    for (let frame = 0; frame < 240; frame += 1) {
      store.tick(STEP, 1);
      const held = store.motion.get(steamTrain.id)!.held;
      expect(positions(store, steamTrain.id)).toHaveLength(1);
      if (held) expectClose(positions(store, steamTrain.id), start);
      else if (releasedAt < 0) releasedAt = frame;
    }
    expect(releasedAt).toBeGreaterThan(0);
    expect(positions(store, dieselTrain.id)[0][0]).toBeGreaterThan(12);
    expect(positions(store, steamTrain.id)[0][0]).toBeGreaterThan(start[0][0] + 1);
  });

  test("the undo stack keeps at most its limit of entries", () => {
    const store = createStore(yardWith([[5, 5, "curve"]]), { undoLimit: 3 });
    for (let i = 0; i < 5; i += 1) store.dispatch({ type: "turn", at: at(5, 5) });
    let undos = 0;
    while (store.canUndo) {
      store.undo();
      undos += 1;
    }
    expect(undos).toBe(3);
  });
});
