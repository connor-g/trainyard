import { COLS, blankBoard, indexAt } from "../src/railway.ts";
import type { Tile } from "../src/railway.ts";
import type { Car, TrackType } from "../src/catalog.ts";
import { applyEdit } from "../src/model/edits.ts";
import type { Edit, EditResult } from "../src/model/edits.ts";
import { initialMotion } from "../src/model/motion.ts";
import type { Motion, Yard } from "../src/model/types.ts";

export const at = (x: number, y: number) => indexAt(x, y, COLS);

export type Piece = readonly [x: number, y: number, type: TrackType, turn?: number];

export function yardWith(pieces: readonly Piece[]): Yard {
  const { grid, cols, rows } = blankBoard();
  const tiles: (Tile | null)[] = grid.slice();
  for (const [x, y, type, turn = 0] of pieces) tiles[at(x, y)] = { type, turn, branch: false };
  return { name: "Test", board: { grid: tiles, cols, rows }, background: "plain", trains: [] };
}

export const straightRow = (from: number, to: number, y: number): Piece[] =>
  Array.from({ length: to - from + 1 }, (_, i) => [from + i, y, "straight"] as const);

/** A 2×2 loop of curves: four quarter circles, about 3.14 long. */
export const tinyLoop = (): Piece[] => [
  [1, 1, "curve", 0],
  [2, 1, "curve", 1],
  [2, 2, "curve", 2],
  [1, 2, "curve", 3],
];

export interface State {
  yard: Yard;
  motion: Motion;
}

export const stateOf = (yard: Yard): State => ({ yard, motion: initialMotion(yard) });

/** Applies an edit and expects it to succeed. */
export function edit(state: State, change: Edit): State & { result: EditResult } {
  const result = applyEdit(state.yard, state.motion, change);
  if (!result.ok) throw new Error("Refused " + change.type + ": " + result.reason);
  return { yard: result.yard, motion: result.motion, result };
}

export const centre = (x: number, y: number) => ({ index: at(x, y), x: 0.5, y: 0.5 });

/** Drops an engine at the centre of (x, y), then drops each further car onto it. */
export function addTrain(state: State, x: number, y: number, cars: readonly Car[]): State {
  let next = state;
  for (const car of cars) next = edit(next, { type: "addCar", car, at: centre(x, y) });
  return next;
}

export const lastTrain = (state: State) => state.yard.trains[state.yard.trains.length - 1];
