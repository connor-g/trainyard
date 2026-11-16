import { describe, expect, test } from "vite-plus/test";
import { STOCK, TRACK } from "../src/railway.ts";
import type { Car, StockType, TrackType } from "../src/railway.ts";
import { applyEdit } from "../src/model/edits.ts";
import type { Edit } from "../src/model/edits.ts";
import { initialMotion, motionEquals, reconcile } from "../src/model/motion.ts";
import { carPositions, isValidStart, occupiedSquares } from "../src/model/queries.ts";
import { initialSimState, step } from "../src/model/simulation.ts";
import type { SimState } from "../src/model/simulation.ts";
import { closestApproach, isValidPath, overlaps } from "../src/model/train.ts";
import { nextTrainId } from "../src/model/types.ts";
import type { Motion, TrainId, Yard } from "../src/model/types.ts";
import { sampleLayout, scenicPresets } from "../src/presets.ts";
import {
  addTrain,
  at,
  centre,
  edit,
  lastTrain,
  stateOf,
  straightRow,
  tinyLoop,
  yardWith,
} from "./helpers.ts";
import type { Piece, State } from "./helpers.ts";

const diesel: Car = { type: "diesel", color: "brick" };
const steam: Car = { type: "steam", color: "pine" };
const box: Car = { type: "box", color: "amber" };
const STEP = 1 / 60;

/** A rectangular loop of track with corners at (x0, y0) and (x1, y1). */
function loop(x0: number, y0: number, x1: number, y1: number): Piece[] {
  const pieces: Piece[] = [
    [x0, y0, "curve", 0],
    [x1, y0, "curve", 1],
    [x1, y1, "curve", 2],
    [x0, y1, "curve", 3],
  ];
  for (let x = x0 + 1; x < x1; x += 1) pieces.push([x, y0, "straight", 0], [x, y1, "straight", 0]);
  for (let y = y0 + 1; y < y1; y += 1) pieces.push([x0, y, "straight", 1], [x1, y, "straight", 1]);
  return pieces;
}

function run(state: State, seconds: number, sim: SimState = initialSimState()) {
  let { motion } = state;
  for (let frame = 0; frame < Math.round(seconds / STEP); frame += 1) {
    ({ motion, sim } = step(state.yard, motion, sim, STEP, 1));
  }
  return { ...state, motion, sim };
}

const positionsOf = (state: State, id: TrainId) => carPositions(state.yard, state.motion).get(id)!;

/** Pairs of trains that overlap right now. */
function overlappingPairs(yard: Yard, motion: Motion) {
  const trains = [...carPositions(yard, motion)];
  const pairs = new Set<string>();
  for (const [i, [a, first]] of trains.entries()) {
    for (const [b, second] of trains.slice(i + 1)) {
      if (overlaps(first, second)) pairs.add([a, b].sort((x, y) => x - y).join("-"));
    }
  }
  return pairs;
}

function expectInvariants(yard: Yard, motion: Motion) {
  expect([...motion.keys()]).toEqual(yard.trains.map((train) => train.id));
  for (const train of yard.trains) {
    expect(isValidStart(yard.board, train.cars.length, train.start)).toBe(true);
    const current = motion.get(train.id)!;
    expect(isValidPath(yard.board, current.history, current.progress, train.cars.length)).toBe(
      true,
    );
    expect(carPositions(yard, motion).get(train.id)).toHaveLength(train.cars.length);
  }
  expect(motionEquals(reconcile(yard, motion), motion)).toBe(true);
}

describe("addCar", () => {
  test("refuses a full train", () => {
    let state = addTrain(stateOf(yardWith(loop(1, 1, 15, 12))), 8, 1, [diesel]);
    for (let i = 1; i < 24; i += 1)
      state = edit(state, { type: "addCar", car: box, at: centre(8, 1) });
    expect(lastTrain(state).cars).toHaveLength(24);
    const result = applyEdit(state.yard, state.motion, {
      type: "addCar",
      car: box,
      at: centre(8, 1),
    });
    expect(result).toEqual({ ok: false, reason: "train-full" });
  });

  test("refuses when the loop is too short", () => {
    const state = addTrain(stateOf(yardWith(tinyLoop())), 1, 1, [diesel, box, box, box]);
    expect(lastTrain(state).cars).toHaveLength(4);
    expect(
      applyEdit(state.yard, state.motion, { type: "addCar", car: box, at: centre(1, 1) }),
    ).toEqual({ ok: false, reason: "loop-too-short" });
  });

  test("refuses when there is not enough track, pulling the train forward when it can", () => {
    const state = addTrain(stateOf(yardWith([[5, 5, "straight"]])), 5, 5, [diesel, box]);
    expectInvariants(state.yard, state.motion);
    expect(
      applyEdit(state.yard, state.motion, { type: "addCar", car: box, at: centre(5, 5) }),
    ).toEqual({ ok: false, reason: "needs-more-track" });
  });

  test("puts a tender directly behind a steam engine", () => {
    const tender: Car = { type: "tender", color: "slate" };
    const state = addTrain(stateOf(yardWith(straightRow(2, 9, 5))), 8, 5, [steam, box, tender]);
    expect(lastTrain(state).cars.map((car) => car.type)).toEqual(["steam", "tender", "box"]);
    expectInvariants(state.yard, state.motion);
  });

  test("needs an engine before other cars", () => {
    const state = stateOf(yardWith(straightRow(2, 9, 5)));
    expect(
      applyEdit(state.yard, state.motion, { type: "addCar", car: box, at: centre(5, 5) }),
    ).toEqual({ ok: false, reason: "needs-engine" });
  });

  test("refuses a new engine too close to another train", () => {
    const state = addTrain(stateOf(yardWith(straightRow(1, 9, 5))), 5, 5, [diesel, box, box]);
    expect(positionsOf(state, lastTrain(state).id).map((car) => car.x)).toEqual([5.5, 4.8, 4.1]);
    expect(
      applyEdit(state.yard, state.motion, { type: "addCar", car: diesel, at: centre(3, 5) }),
    ).toEqual({ ok: false, reason: "engine-blocked" });
  });

  test("a coupled car never lands on another train", () => {
    // Two trains nose to tail: a longer first train would reach back into the second.
    let state = addTrain(stateOf(yardWith(straightRow(1, 12, 5))), 8, 5, [diesel]);
    state = addTrain(state, 7, 5, [diesel]);
    const first = state.yard.trains[0];
    expect(
      applyEdit(state.yard, state.motion, { type: "addCar", car: box, at: centre(8, 5) }),
    ).toEqual({ ok: false, reason: "square-occupied" });
    expect(first.cars).toHaveLength(1);
  });
});

describe("track edits", () => {
  test("can't remove, move or replace track under any part of a train", () => {
    const state = addTrain(stateOf(yardWith(straightRow(1, 9, 5))), 6, 5, [diesel, box, box]);
    const occupied = occupiedSquares(state.yard, state.motion);
    // Cars sit at 6.5, 5.8 and 5.1; square 5 has no car centre on it, but the train covers it.
    expect([...occupied].sort((a, b) => a - b)).toEqual([at(5, 5), at(6, 5)]);
    for (const change of [
      { type: "removeTrack", at: at(5, 5) },
      { type: "placeTrack", at: at(5, 5), track: "curve" },
      { type: "moveTrack", from: at(5, 5), to: at(5, 7) },
    ] satisfies Edit[]) {
      expect(applyEdit(state.yard, state.motion, change)).toEqual({
        ok: false,
        reason: "square-occupied",
      });
    }
  });

  test("removing track on a start path moves the start to where the train is now", () => {
    let state = addTrain(stateOf(yardWith(straightRow(1, 12, 5))), 3, 5, [diesel, box]);
    state = run(state, 2);
    const train = lastTrain(state);
    expect(positionsOf(state, train.id)[1].x).toBeGreaterThan(4.5);
    state = edit(state, { type: "removeTrack", at: at(2, 5) });
    const moved = lastTrain(state);
    expect(moved.start).not.toEqual(train.start);
    expect(moved.start.progress).toBe(state.motion.get(train.id)!.progress);
    expectInvariants(state.yard, state.motion);
  });

  test("resizing moves trains and starts with the track", () => {
    const state = run(stateOf(sampleLayout()), 3);
    const [before] = carPositions(state.yard, state.motion).values();
    const { yard, motion, result } = edit(state, { type: "resize", size: { cols: 12, rows: 9 } });
    expect(result.ok && result.remap).toBeTruthy();
    const [after] = carPositions(yard, motion).values();
    const dx = after[0].x - before[0].x;
    const dy = after[0].y - before[0].y;
    for (const [i, car] of after.entries()) {
      expect(car.x - before[i].x).toBeCloseTo(dx);
      expect(car.y - before[i].y).toBeCloseTo(dy);
    }
    expectInvariants(yard, motion);
  });

  test("refuses a size the yard doesn't fit", () => {
    const state = stateOf(scenicPresets()[0]);
    expect(
      applyEdit(state.yard, state.motion, { type: "resize", size: { cols: 9, rows: 7 } }),
    ).toEqual({ ok: false, reason: "too-big-for-size" });
  });
});

describe("step", () => {
  test("two trains take turns at a crossing without touching", () => {
    const yard = scenicPresets().find((preset) => preset.name === "Red Mesa Crossing")!;
    let motion = initialMotion(yard);
    let sim = initialSimState();
    let closest = Infinity;
    const travelled = new Map<TrainId, number>();
    for (let frame = 0; frame < 60 * 60; frame += 1) {
      const before = carPositions(yard, motion);
      ({ motion, sim } = step(yard, motion, sim, STEP, 1));
      const after = [...carPositions(yard, motion)];
      closest = Math.min(closest, closestApproach(after[0][1], after[1][1]));
      for (const [id, cars] of after) {
        const [engine] = before.get(id)!;
        const moved = Math.hypot(cars[0].x - engine.x, cars[0].y - engine.y);
        travelled.set(id, (travelled.get(id) ?? 0) + moved);
      }
    }
    expect(closest).toBeGreaterThan(0.5);
    for (const distance of travelled.values()) expect(distance).toBeGreaterThan(40);
  });

  test("a train stops at a station", () => {
    let state = stateOf(
      yardWith([
        [2, 5, "straight"],
        [3, 5, "straight"],
        [4, 5, "station"],
        [5, 5, "straight"],
        [6, 5, "straight"],
      ]),
    );
    state = addTrain(state, 3, 5, [diesel]);
    const id = lastTrain(state).id;
    let { motion } = state;
    let sim = initialSimState();
    let stations = 0;
    const xs: number[] = [];
    for (let frame = 0; frame < 240; frame += 1) {
      const next = step(state.yard, motion, sim, STEP, 1);
      ({ motion, sim } = next);
      stations += next.events.stationArrivals;
      xs.push(carPositions(state.yard, motion).get(id)![0].x);
    }
    expect(stations).toBe(1);
    // It arrives at the platform midpoint, waits 1.6 seconds, then leaves.
    const stopped = xs.filter((x) => x === 4.5).length;
    expect(stopped).toBeGreaterThanOrEqual(95);
    expect(stopped).toBeLessThanOrEqual(99);
    expect(xs.at(-1)).toBeGreaterThan(4.5);
  });

  test("speed 0 changes nothing", () => {
    const state = stateOf(sampleLayout());
    const sim = initialSimState();
    const result = step(state.yard, state.motion, sim, STEP, 0);
    expect(result.motion).toBe(state.motion);
    expect(result.sim).toBe(sim);
  });
});

describe("overlapping trains", () => {
  /** A yard whose trains start on the given paths along row 5, all heading right. */
  function rowYard(starts: [square: number, progress: number, cars: Car[]][], from = 1, to = 15) {
    const base = yardWith(straightRow(from, to, 5));
    return {
      ...base,
      trains: starts.map(([square, progress, cars]) => {
        const path = [];
        for (let x = square - Math.ceil(cars.length * 0.7); x <= square; x += 1) {
          if (x >= from) path.push({ index: at(x, 5), from: 3, to: 1 });
        }
        return { id: nextTrainId(), cars, start: { path, progress } };
      }),
    } satisfies Yard;
  }

  test("a yard with overlapping starts loads with the later train held", () => {
    const yard = rowYard([
      [8, 0.5, [diesel, box]],
      [8, 0.6, [steam]],
      [3, 0.5, [diesel]],
    ]);
    const motion = initialMotion(yard);
    expect(yard.trains.map((train) => motion.get(train.id)!.held)).toEqual([false, true, false]);
  });

  test("a held train stays still and visible, then drives off once the other has cleared it", () => {
    const yard = rowYard([
      [8, 0.5, [diesel]],
      [8, 0.5, [steam]],
    ]);
    const [first, second] = yard.trains;
    let state: State = stateOf(yard);
    let sim = initialSimState();
    const start = positionsOf(state, second.id)[0];
    let released = -1;
    for (let frame = 0; frame < 240; frame += 1) {
      ({ motion: state.motion, sim } = step(state.yard, state.motion, sim, STEP, 1));
      const held = state.motion.get(second.id)!.held;
      const [engine] = positionsOf(state, second.id);
      expect(positionsOf(state, second.id)).toHaveLength(1);
      if (held) expect(engine).toEqual(start);
      if (!held && released < 0) released = frame;
      // A train is released on the first step after nothing overlaps it.
      if (!held) expect(overlappingPairs(state.yard, state.motion).size).toBe(0);
    }
    expect(released).toBeGreaterThan(0);
    expect(positionsOf(state, second.id)[0].x).toBeGreaterThan(start.x + 1);
    // The released train follows rather than catching up.
    expect(
      closestApproach(positionsOf(state, first.id), positionsOf(state, second.id)),
    ).toBeGreaterThanOrEqual(0.58 - 0.05);
  });

  test("a third train is still stopped by a held train", () => {
    // The first train is parked at the end of the line, so the second stays held on top of it.
    const yard = rowYard([
      [15, 0.71, [diesel]],
      [15, 0.71, [steam]],
      [4, 0.5, [diesel]],
    ]);
    const [, held, third] = yard.trains;
    let state: State = stateOf(yard);
    state = run(state, 12);
    expect(state.motion.get(held.id)!.held).toBe(true);
    const gap = closestApproach(positionsOf(state, third.id), positionsOf(state, held.id));
    expect(gap).toBeGreaterThanOrEqual(0.58 - 0.05);
    expect(gap).toBeLessThan(0.8);
  });
});

/** A small seeded random source, so failures can be replayed. */
function random(seed: number) {
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

describe("invariants under random edits", () => {
  const trackTypes = Object.keys(TRACK) as TrackType[];
  const stockTypes = Object.keys(STOCK) as StockType[];

  function randomEdit(rand: () => number, { yard, motion }: State): Edit {
    const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
    const squares = yard.board.cols * yard.board.rows;
    const tiles = yard.board.grid.flatMap((tile, index) => (tile ? [index] : []));
    const point = () => ({ index: pick(tiles), x: rand(), y: rand() });
    const kind = rand();
    if (kind < 0.2)
      return { type: "placeTrack", at: Math.floor(rand() * squares), track: pick(trackTypes) };
    if (kind < 0.3)
      return { type: "moveTrack", from: pick(tiles), to: Math.floor(rand() * squares) };
    if (kind < 0.45) return { type: "turn", at: pick(tiles) };
    if (kind < 0.55) return { type: "removeTrack", at: pick(tiles) };
    if (kind < 0.8) {
      const type = pick(stockTypes);
      return { type: "addCar", car: { type, color: "teal" }, at: point() };
    }
    const positions = [...carPositions(yard, motion)];
    if (kind < 0.9 && positions.length) {
      const [trainId, cars] = pick(positions);
      return { type: "removeCar", car: { trainId, carIndex: Math.floor(rand() * cars.length) } };
    }
    if (kind < 0.93)
      return { type: "setBackground", background: pick(["plain", "desert"] as const) };
    if (kind < 0.985) {
      const sizes = [
        { cols: 17, rows: 14 },
        { cols: 12, rows: 9 },
      ];
      return { type: "resize", size: pick(sizes) };
    }
    if (kind < 0.995) return { type: "rename", name: "Yard " + Math.floor(rand() * 10) };
    return { type: "replace", yard: pick([sampleLayout(), ...scenicPresets()]) };
  }

  for (const [seed, yard] of [sampleLayout(), ...scenicPresets()].entries()) {
    test(yard.name, () => {
      const rand = random(seed + 1);
      let state: State = stateOf(yard);
      let sim = initialSimState();
      let edits = 0;
      for (let round = 0; round < 250; round += 1) {
        const change = randomEdit(rand, state);
        const before = overlappingPairs(state.yard, state.motion);
        const result = applyEdit(state.yard, state.motion, change);
        if (result.ok) {
          edits += 1;
          state = { yard: result.yard, motion: result.motion };
          expectInvariants(state.yard, state.motion);
          // Edits never create overlaps.
          for (const pair of overlappingPairs(state.yard, state.motion))
            expect(before.has(pair), change.type).toBe(true);
        }
        const frames = Math.floor(rand() * 90);
        for (let frame = 0; frame < frames; frame += 1) {
          const previous = overlappingPairs(state.yard, state.motion);
          ({ motion: state.motion, sim } = step(state.yard, state.motion, sim, STEP, 2));
          for (const pair of overlappingPairs(state.yard, state.motion))
            expect(previous.has(pair)).toBe(true);
        }
        expectInvariants(state.yard, state.motion);
      }
      expect(edits).toBeGreaterThan(50);
    });
  }
});

describe("immutability", () => {
  test("yards and motion are frozen", () => {
    const state = addTrain(stateOf(sampleLayout()), 8, 2, [diesel]);
    expect(() => {
      (state.yard.trains as unknown as unknown[]).push(1);
    }).toThrow();
    expect(() => {
      (state.motion as Map<TrainId, unknown>).set(1 as TrainId, null);
    }).toThrow();
    expect(() => {
      (state.yard.board.grid as unknown as unknown[])[0] = null;
    }).toThrow();
  });
});
