/** Reads and writes yards in local storage. A save holds the yard as built, with each train at its start. */
import { GRID_SIZES, STOCK, TRACK, isBackground } from "./railway.ts";
import type { Background, Car, SegmentRef, Tile } from "./railway.ts";
import { frozen } from "./model/freeze.ts";
import { isValidStart } from "./model/queries.ts";
import { MAX_CARS } from "./model/train.ts";
import { nextTrainId } from "./model/types.ts";
import type { StartPath, Yard } from "./model/types.ts";

/** The saved shape: a yard without train ids, which are assigned on load. */
export interface SavedYard {
  name: string;
  cols: number;
  rows: number;
  grid: (Tile | null)[];
  background: Background;
  trains: { cars: Car[]; start: { path: SegmentRef[]; progress: number } }[];
}

export function toSaved(yard: Yard): SavedYard {
  const { grid, cols, rows } = yard.board;
  return {
    name: yard.name,
    cols,
    rows,
    grid: [...grid],
    background: yard.background,
    trains: yard.trains.map(({ cars, start }) => ({
      cars: [...cars],
      start: {
        path: start.path.map(({ index, from, to }) => ({ index, from, to })),
        progress: start.progress,
      },
    })),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isTile = (value: unknown): value is Tile =>
  isRecord(value) &&
  typeof value.type === "string" &&
  Object.hasOwn(TRACK, value.type) &&
  Number.isInteger(value.turn) &&
  typeof value.branch === "boolean";

const isCar = (value: unknown): value is Car =>
  isRecord(value) && typeof value.type === "string" && Object.hasOwn(STOCK, value.type);

const isStart = (value: unknown): value is StartPath =>
  isRecord(value) &&
  typeof value.progress === "number" &&
  Array.isArray(value.path) &&
  value.path.every(
    (piece) => isRecord(piece) && [piece.index, piece.from, piece.to].every(Number.isInteger),
  );

/**
 * Reads a saved yard, or returns null if it isn't one this version can play. This checks enough
 * to keep the game running; the persistence follow-up adds a versioned format with full validation.
 */
export function fromSaved(value: unknown): Yard | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  const { cols, rows, grid, trains } = value;
  if (!GRID_SIZES.some((size) => size.cols === cols && size.rows === rows)) return null;
  if (!Array.isArray(grid) || grid.length !== (cols as number) * (rows as number)) return null;
  if (!grid.every((tile) => tile === null || isTile(tile))) return null;
  if (!isBackground(value.background) || !Array.isArray(trains)) return null;
  const board = { grid: grid as Tile[], cols: cols as number, rows: rows as number };
  const valid = trains.every(
    (train) =>
      isRecord(train) &&
      Array.isArray(train.cars) &&
      train.cars.length > 0 &&
      train.cars.length <= MAX_CARS &&
      train.cars.every(isCar) &&
      isStart(train.start) &&
      isValidStart(board, train.cars.length, train.start),
  );
  if (!valid) return null;
  return frozen({
    name: value.name,
    board,
    background: value.background,
    trains: (trains as SavedYard["trains"]).map(({ cars, start }) => ({
      id: nextTrainId(),
      cars,
      start,
    })),
  });
}
