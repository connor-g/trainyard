import { describe, expect, test } from "vite-plus/test";

import type { Tile } from "../src/railway.ts";
import { fitTrack, rotateTrack } from "../src/track-fitting.ts";
import { at, yardWith } from "./helpers.ts";

describe("fitTrack", () => {
  test("places a lone piece in its first orientation", () => {
    const { board } = yardWith([]);
    expect(fitTrack(board, at(5, 5), "curve")).toEqual([
      [at(5, 5), { type: "curve", turn: 0, branch: false }],
    ]);
  });

  test("turns a piece to connect with its neighbour", () => {
    const { board } = yardWith([[4, 5, "straight", 0]]);
    expect(fitTrack(board, at(5, 5), "curve")).toEqual([
      [at(5, 5), { type: "curve", turn: 1, branch: false }],
    ]);
  });

  test("turns an unconnected neighbour to meet the new piece", () => {
    const { board } = yardWith([[4, 5, "straight", 1]]);
    expect(fitTrack(board, at(5, 5), "straight")).toEqual([
      [at(5, 5), { type: "straight", turn: 0, branch: false }],
      [at(4, 5), { type: "straight", turn: 0, branch: false }],
    ]);
  });

  test("leaves occupied neighbours alone", () => {
    const { board } = yardWith([[4, 5, "straight", 1]]);
    const occupied = new Set([at(4, 5)]);
    expect(fitTrack(board, at(5, 5), "straight", occupied)).toEqual([
      [at(5, 5), { type: "straight", turn: 0, branch: false }],
    ]);
  });
});

describe("rotateTrack", () => {
  test("turns a lone straight", () => {
    const { board } = yardWith([[5, 5, "straight", 0]]);
    expect(rotateTrack(board, at(5, 5))).toEqual({ type: "straight", turn: 1, branch: false });
  });

  test("cycles a lone curve through four turns", () => {
    let { board } = yardWith([[5, 5, "curve", 0]]);
    const turns = [];
    for (let i = 0; i < 4; i += 1) {
      const next: Tile = rotateTrack(board, at(5, 5))!;
      board = { ...board, grid: board.grid.with(at(5, 5), next) };
      turns.push(next.turn);
    }
    expect(turns).toEqual([1, 2, 3, 0]);
  });

  test("flips a fully connected switch instead of turning it", () => {
    // A right switch enters from the left and leaves right or down.
    const { board } = yardWith([
      [4, 5, "straight", 0],
      [5, 5, "right", 0],
      [6, 5, "straight", 0],
      [5, 6, "straight", 1],
    ]);
    expect(rotateTrack(board, at(5, 5))).toEqual({ type: "right", turn: 0, branch: true });
  });
});
