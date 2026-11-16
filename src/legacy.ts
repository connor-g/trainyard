import { STOCK, expandStandardYard, gridSize, isBackground, isEngine } from "./railway.ts";
import type { Car, Grid, Layout, Segment, Train } from "./railway.ts";

/** The shape the app has always written to local storage. */
export interface LegacyYard {
  name: string;
  cols: number;
  rows: number;
  grid: Grid;
  trains: { cars: Car[]; history: Segment[]; progress: number }[];
  landscape: boolean;
  background?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function legacyTrain(value: unknown): Train | null {
  if (!isRecord(value) || !Array.isArray(value.cars) || !Array.isArray(value.history)) return null;
  // Snowplows are no longer part of the catalog, so only those cars are dropped.
  const cars = (value.cars as unknown[]).filter(
    (car): car is Car =>
      isRecord(car) && typeof car.type === "string" && Object.hasOwn(STOCK, car.type),
  );
  if (!cars.some((car) => isEngine(car.type))) return null;
  if (!value.history.length || typeof value.progress !== "number") return null;
  return { cars, history: value.history as Segment[], progress: value.progress };
}

/** Reads a yard saved by any earlier version, or returns null if it can't be used. */
export function fromLegacy(value: unknown): Layout | null {
  if (!isRecord(value)) return null;
  const raw = expandStandardYard(value);
  const { cols, rows } = gridSize(raw);
  if (!Array.isArray(raw.grid) || raw.grid.length !== cols * rows) return null;
  if (!Array.isArray(raw.trains)) return null;
  return {
    name: typeof raw.name === "string" ? raw.name : "New Layout",
    board: { grid: raw.grid as Grid, cols, rows },
    background: isBackground(raw.background) ? raw.background : raw.landscape ? "meadow" : "plain",
    trains: raw.trains.flatMap((train) => legacyTrain(train) ?? []),
  };
}

export function toLegacy(layout: Layout): LegacyYard {
  const { grid, cols, rows } = layout.board;
  return {
    name: layout.name,
    cols,
    rows,
    grid,
    trains: layout.trains.map(({ cars, history, progress }) => ({ cars, history, progress })),
    landscape: layout.background !== "plain",
    background: layout.background,
  };
}
