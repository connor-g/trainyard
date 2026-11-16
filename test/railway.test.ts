import { describe, expect, test } from "vite-plus/test";
import {
  advance,
  blankLayout,
  carPositions,
  couple,
  fitTrack,
  indexAt,
  initialSimState,
  rotateTrack,
  startTrain,
} from "../src/railway.ts";
import type { Board, Car, Layout, TrackType, Train } from "../src/railway.ts";
import { scenicPresets } from "../src/presets.ts";

const COLS = 17;
const engine: Car = { type: "diesel", color: "brick" };
const box: Car = { type: "box", color: "amber" };

function yardWith(pieces: [x: number, y: number, type: TrackType, turn?: number][]): Layout {
  const yard = blankLayout();
  for (const [x, y, type, turn = 0] of pieces) {
    yard.board.grid[indexAt(x, y, COLS)] = { type, turn, branch: false };
  }
  return yard;
}

/** A 2×2 loop of curves: four quarter circles, about 3.14 long. */
const tinyLoop = (): Layout =>
  yardWith([
    [1, 1, "curve", 0],
    [2, 1, "curve", 1],
    [2, 2, "curve", 2],
    [1, 2, "curve", 3],
  ]);

function trainOn(board: Board, x: number, y: number, car = engine): Train {
  return startTrain(board, indexAt(x, y, COLS), car)!;
}

describe("fitTrack", () => {
  test("places a lone piece in its first orientation", () => {
    const { board } = blankLayout();
    expect(fitTrack(board, indexAt(5, 5, COLS), "curve")).toEqual([
      [indexAt(5, 5, COLS), { type: "curve", turn: 0, branch: false }],
    ]);
  });

  test("turns a piece to connect with its neighbour", () => {
    const { board } = yardWith([[4, 5, "straight", 0]]);
    expect(fitTrack(board, indexAt(5, 5, COLS), "curve")).toEqual([
      [indexAt(5, 5, COLS), { type: "curve", turn: 1, branch: false }],
    ]);
  });

  test("turns an unconnected neighbour to meet the new piece", () => {
    const { board } = yardWith([[4, 5, "straight", 1]]);
    expect(fitTrack(board, indexAt(5, 5, COLS), "straight")).toEqual([
      [indexAt(5, 5, COLS), { type: "straight", turn: 0, branch: false }],
      [indexAt(4, 5, COLS), { type: "straight", turn: 0, branch: false }],
    ]);
  });

  test("leaves occupied neighbours alone", () => {
    const { board } = yardWith([[4, 5, "straight", 1]]);
    const occupied = new Set([indexAt(4, 5, COLS)]);
    expect(fitTrack(board, indexAt(5, 5, COLS), "straight", occupied)).toEqual([
      [indexAt(5, 5, COLS), { type: "straight", turn: 0, branch: false }],
    ]);
  });
});

describe("rotateTrack", () => {
  test("turns a lone straight", () => {
    const { board } = yardWith([[5, 5, "straight", 0]]);
    expect(rotateTrack(board, indexAt(5, 5, COLS))).toEqual({
      type: "straight",
      turn: 1,
      branch: false,
    });
  });

  test("cycles a lone curve through four turns", () => {
    const yard = yardWith([[5, 5, "curve", 0]]);
    const turns = [];
    for (let i = 0; i < 4; i += 1) {
      const next = rotateTrack(yard.board, indexAt(5, 5, COLS))!;
      yard.board.grid[indexAt(5, 5, COLS)] = next;
      turns.push(next.turn);
    }
    expect(turns).toEqual([1, 2, 3, 0]);
  });

  test("flips a fully connected switch instead of turning it", () => {
    // A right switch enters from the left and leaves right or down.
    const yard = yardWith([
      [4, 5, "straight", 0],
      [5, 5, "right", 0],
      [6, 5, "straight", 0],
      [5, 6, "straight", 1],
    ]);
    expect(rotateTrack(yard.board, indexAt(5, 5, COLS))).toEqual({
      type: "right",
      turn: 0,
      branch: true,
    });
  });
});

describe("couple", () => {
  test("refuses a full train", () => {
    const yard = yardWith(Array.from({ length: 15 }, (_, x) => [x + 1, 5, "straight"] as const));
    const train = trainOn(yard.board, 15, 5);
    train.cars.push(...Array.from({ length: 23 }, () => box));
    expect(couple(yard.board, train, box)).toBe("train-full");
  });

  test("refuses when the loop is too short", () => {
    const yard = tinyLoop();
    const train = trainOn(yard.board, 1, 1);
    expect(couple(yard.board, train, box)).toBeNull();
    expect(couple(yard.board, train, box)).toBeNull();
    expect(couple(yard.board, train, box)).toBeNull();
    expect(couple(yard.board, train, box)).toBe("loop-too-short");
    expect(train.cars).toHaveLength(4);
  });

  test("refuses when there is not enough track", () => {
    const yard = yardWith([[5, 5, "straight"]]);
    const train = trainOn(yard.board, 5, 5);
    expect(couple(yard.board, train, box)).toBeNull();
    expect(couple(yard.board, train, box)).toBe("needs-more-track");
    expect(train.cars).toHaveLength(2);
  });

  test("puts a tender directly behind a steam engine", () => {
    const yard = yardWith(Array.from({ length: 8 }, (_, x) => [x + 2, 5, "straight"] as const));
    const train = trainOn(yard.board, 8, 5, { type: "steam", color: "pine" });
    expect(couple(yard.board, train, box)).toBeNull();
    expect(couple(yard.board, train, { type: "tender", color: "slate" }, 1)).toBeNull();
    expect(train.cars.map((car) => car.type)).toEqual(["steam", "tender", "box"]);
    expect(carPositions(train, COLS)).toHaveLength(3);
  });
});

describe("advance", () => {
  test("two trains take turns at a crossing without touching", () => {
    const yard = scenicPresets().find((preset) => preset.name === "Red Mesa Crossing")!;
    const sim = initialSimState();
    let closest = Infinity;
    const travelled = yard.trains.map(() => 0);
    for (let frame = 0; frame < 60 * 60; frame += 1) {
      const before = yard.trains.map((train) => carPositions(train, COLS)[0]);
      advance(yard.board, yard.trains, sim, 1.6 / 60, 1 / 60);
      const [first, second] = yard.trains.map((train) => carPositions(train, COLS));
      for (const a of first) {
        for (const b of second) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
      }
      yard.trains.forEach((train, i) => {
        const [car] = carPositions(train, COLS);
        travelled[i] += Math.hypot(car.x - before[i].x, car.y - before[i].y);
      });
    }
    expect(closest).toBeGreaterThan(0.5);
    for (const distance of travelled) expect(distance).toBeGreaterThan(40);
  });

  test("a train stops at a station", () => {
    const yard = yardWith([
      [2, 5, "straight"],
      [3, 5, "straight"],
      [4, 5, "station"],
      [5, 5, "straight"],
      [6, 5, "straight"],
    ]);
    const train = trainOn(yard.board, 3, 5);
    const sim = initialSimState();
    let stations = 0;
    const xs: number[] = [];
    for (let frame = 0; frame < 240; frame += 1) {
      advance(yard.board, [train], sim, 1.6 / 60, 1 / 60, () => (stations += 1));
      xs.push(carPositions(train, COLS)[0].x);
    }
    expect(stations).toBe(1);
    // It arrives at the platform midpoint, waits 1.6 seconds, then leaves.
    const stopped = xs.filter((x) => x === 4.5).length;
    expect(stopped).toBeGreaterThanOrEqual(95);
    expect(stopped).toBeLessThanOrEqual(99);
    expect(xs.at(-1)).toBeGreaterThan(4.5);
  });
});
