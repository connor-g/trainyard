/**
 * Converts yards to and from their saved shape. A save holds the yard as built, with each train at
 * its start. Saved yards can come from another device through a shared library, so `parseSaved`
 * checks everything the game relies on before a yard reaches the model or the renderer.
 */

import { COLORS, STOCK, TRACK, isBackground, isEngine } from "./catalog.ts";
import type { Background, Car } from "./catalog.ts";
import { isRecord } from "./guards.ts";
import { isValidStart } from "./model/queries.ts";
import { MAX_CARS } from "./model/train.ts";
import { nextTrainId } from "./model/types.ts";
import type { Yard } from "./model/types.ts";
import { GRID_SIZES } from "./railway.ts";
import type { GridSize, SegmentRef, Tile } from "./railway.ts";

/** The saved shape: a yard without train ids, which are assigned on load. */
export interface SavedYard {
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
  readonly grid: readonly (Tile | null)[];
  readonly background: Background;
  readonly trains: readonly {
    readonly cars: readonly Car[];
    readonly start: { readonly path: readonly SegmentRef[]; readonly progress: number };
  }[];
}

/** A plain copy, so a saved yard never shares objects with the yard it came from. */
function copySaved({ name, cols, rows, grid, background, trains }: SavedYard): SavedYard {
  return {
    name,
    cols,
    rows,
    grid: grid.map((tile) => tile && { type: tile.type, turn: tile.turn, branch: tile.branch }),
    background,
    trains: trains.map(({ cars, start }) => ({
      cars: cars.map(({ type, color }) => ({ type, color })),
      start: {
        path: start.path.map(({ index, from, to }) => ({ index, from, to })),
        progress: start.progress,
      },
    })),
  };
}

export function toSaved({ name, board, background, trains }: Yard): SavedYard {
  return copySaved({ name, ...board, background, trains });
}

/** An empty yard in its saved shape. */
export function blankSaved(
  name: string,
  { cols, rows }: GridSize,
  background: Background,
): SavedYard {
  return {
    name,
    cols,
    rows,
    grid: Array<null>(cols * rows).fill(null),
    background,
    trains: [],
  };
}

const isKey = <T extends object>(catalog: T, value: unknown): value is keyof T =>
  typeof value === "string" && Object.hasOwn(catalog, value);

const isTile = (value: unknown): value is Tile =>
  isRecord(value) &&
  isKey(TRACK, value.type) &&
  Number.isInteger(value.turn) &&
  (value.turn as number) >= 0 &&
  (value.turn as number) < 4 &&
  typeof value.branch === "boolean";

const isCar = (value: unknown): value is Car =>
  isRecord(value) && isKey(STOCK, value.type) && isKey(COLORS, value.color);

const isPort = (value: unknown) => Number.isInteger(value) && (value as number) >= -1;

const isStart = (value: unknown): value is SavedYard["trains"][number]["start"] =>
  isRecord(value) &&
  Number.isFinite(value.progress) &&
  Array.isArray(value.path) &&
  value.path.every(
    (piece) =>
      isRecord(piece) && Number.isInteger(piece.index) && isPort(piece.from) && isPort(piece.to),
  );

/** Reads a saved yard, or returns null if it isn't one this version can play. */
export function parseSaved(value: unknown): SavedYard | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  const { cols, rows, grid, trains, background } = value;
  const size = GRID_SIZES.find((option) => option.cols === cols && option.rows === rows);
  if (!size || !Array.isArray(grid) || grid.length !== size.cols * size.rows) return null;
  if (!grid.every((tile) => tile === null || isTile(tile))) return null;
  if (!isBackground(background) || !Array.isArray(trains)) return null;
  const board = { grid: grid as Tile[], cols: size.cols, rows: size.rows };
  const valid = trains.every(
    (train) =>
      isRecord(train) &&
      Array.isArray(train.cars) &&
      train.cars.length > 0 &&
      train.cars.length <= MAX_CARS &&
      train.cars.every(isCar) &&
      // Removing the last engine removes the train, so every train has one.
      train.cars.some((car: Car) => isEngine(car.type)) &&
      isStart(train.start) &&
      isValidStart(board, train.cars.length, train.start),
  );
  if (!valid) return null;
  return copySaved({
    name: value.name,
    ...board,
    background,
    trains: trains as SavedYard["trains"],
  });
}

/** Turns a saved yard into a yard with fresh train ids. */
export function fromSaved(saved: SavedYard): Yard {
  const { name, cols, rows, grid, background, trains } = saved;
  return {
    name,
    board: { grid, cols, rows },
    background,
    trains: trains.map(({ cars, start }) => ({ id: nextTrainId(), cars, start })),
  };
}
