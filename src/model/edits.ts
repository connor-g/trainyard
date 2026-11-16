import { cellAt, indexAt, nextSegments, onward, pathKey, routesAt, segment } from "../railway.ts";
import { isEngine } from "../catalog.ts";
import { fitTrack, rotateTrack } from "../track-fitting.ts";
import type { Board, Grid, GridSize, Segment, Tile } from "../railway.ts";
import type { Background, Car, TrackType } from "../catalog.ts";
import type { TrackEdit } from "../track-fitting.ts";
import { initialMotion, motionOf, remapMotion } from "./motion.ts";
import { carAt, carPositions, isValidStart, occupiedSquares } from "./queries.ts";
import {
  CAR_GAP,
  END_CLEARANCE,
  ENGINE_CLEARANCE,
  MAX_CARS,
  carPositionsOn,
  closestApproach,
  coveredPath,
  deadEndStop,
  extendTail,
  lengthBehind,
  overlaps,
  placeCar,
  toRefs,
  toSegments,
  validSuffix,
} from "./train.ts";
import { nextTrainId } from "./types.ts";
import type {
  BoardPoint,
  CarRef,
  Motion,
  StartPath,
  TrainId,
  TrainMotion,
  TrainSpec,
  Yard,
} from "./types.ts";

export type Edit =
  | { readonly type: "placeTrack"; readonly at: number; readonly track: TrackType }
  | { readonly type: "moveTrack"; readonly from: number; readonly to: number }
  /** Rotates, or flips a fully connected switch. */
  | { readonly type: "turn"; readonly at: number }
  | { readonly type: "removeTrack"; readonly at: number }
  /** A new train, or couples to the car hit or the nearest train. */
  | { readonly type: "addCar"; readonly car: Car; readonly at: BoardPoint }
  | { readonly type: "removeCar"; readonly car: CarRef }
  | { readonly type: "setBackground"; readonly background: Background }
  | { readonly type: "resize"; readonly size: GridSize }
  /** Loads a yard or starts blank. */
  | { readonly type: "replace"; readonly yard: Yard }
  /** Not undoable. */
  | { readonly type: "rename"; readonly name: string };

/** Why an edit was refused. The UI decides how to word it. */
export type Refusal =
  | "square-occupied"
  | "needs-track"
  | "needs-engine"
  | "engine-blocked"
  | "train-full"
  | "loop-too-short"
  | "needs-more-track"
  | "too-big-for-size"
  | "no-change";

export type EditResult =
  | {
      readonly ok: true;
      readonly yard: Yard;
      readonly motion: Motion;
      /** Maps indices on the new board to the previous one (-1 if off the grid). Set by `resize`. */
      readonly remap?: (index: number) => number;
    }
  | { readonly ok: false; readonly reason: Refusal };

const refuse = (reason: Refusal): EditResult => ({ ok: false, reason });

/** The start a train falls back to when its own is no longer valid: where it is right now. */
function currentStart(current: TrainMotion, cars: number): StartPath {
  return {
    path: toRefs(coveredPath(current.history, current.progress, cars)),
    progress: current.progress,
  };
}

/**
 * Finishes an edit: trims history behind each train that is no longer on track, and re-checks
 * every train's start. When an edit has made a start invalid, the start becomes the train's
 * current position.
 */
function settle(yard: Yard, motion: Motion, remap?: (index: number) => number): EditResult {
  const { board } = yard;
  const nextMotion = new Map<TrainId, TrainMotion>();
  for (const train of yard.trains) {
    const current = motionOf(motion, train.id);
    const history = validSuffix(board, current.history);
    nextMotion.set(train.id, history === current.history ? current : { ...current, history });
  }
  const trains = yard.trains.map((train) =>
    isValidStart(board, train.cars.length, train.start)
      ? train
      : { ...train, start: currentStart(motionOf(nextMotion, train.id), train.cars.length) },
  );
  const changed = trains.some((train, i) => train !== yard.trains[i]);
  return {
    ok: true,
    yard: changed ? { ...yard, trains } : yard,
    motion: nextMotion,
    ...(remap && { remap }),
  };
}

function withTiles(board: Board, edits: readonly (readonly [number, Tile | null])[]): Board {
  const grid = board.grid.slice();
  for (const [index, tile] of edits) grid[index] = tile;
  return { ...board, grid };
}

function placeTrack(yard: Yard, motion: Motion, at: number, track: TrackType): EditResult {
  const occupied = occupiedSquares(yard, motion);
  if (occupied.has(at)) return refuse("square-occupied");
  const edits = fitTrack(yard.board, at, track, occupied);
  const tile = yard.board.grid[at];
  if (edits.length === 1 && tile?.type === track && tile.turn === edits[0][1].turn)
    return refuse("no-change");
  return settle({ ...yard, board: withTiles(yard.board, edits) }, motion);
}

function moveTrack(yard: Yard, motion: Motion, from: number, to: number): EditResult {
  if (from === to) return refuse("no-change");
  const tile = yard.board.grid[from];
  if (!tile) return refuse("needs-track");
  const occupied = occupiedSquares(yard, motion);
  if (occupied.has(from) || occupied.has(to)) return refuse("square-occupied");
  const lifted = withTiles(yard.board, [[from, null]]);
  const moved: TrackEdit[] = fitTrack(lifted, to, tile.type, occupied, tile);
  return settle({ ...yard, board: withTiles(lifted, moved) }, motion);
}

function turn(yard: Yard, motion: Motion, at: number): EditResult {
  const tile = yard.board.grid[at];
  if (!tile) return refuse("needs-track");
  const rotated = rotateTrack(yard.board, at);
  if (!rotated) return refuse("no-change");
  // Flipping a switch under a train is fine: a path never depends on how switches are set.
  if (rotated.turn !== tile.turn && occupiedSquares(yard, motion).has(at))
    return refuse("square-occupied");
  return settle({ ...yard, board: withTiles(yard.board, [[at, rotated]]) }, motion);
}

function removeTrack(yard: Yard, motion: Motion, at: number): EditResult {
  if (!yard.board.grid[at]) return refuse("no-change");
  if (occupiedSquares(yard, motion).has(at)) return refuse("square-occupied");
  return settle({ ...yard, board: withTiles(yard.board, [[at, null]]) }, motion);
}

/** The train whose engine is nearest along the track from a board point. */
function nearestTrain(yard: Yard, motion: Motion, point: BoardPoint): TrainId | null {
  const { board } = yard;
  const tile = board.grid[point.index];
  if (!tile || !yard.trains.length) return null;
  const queue = routesAt(tile, point.x, point.y).flatMap(([a, b]) => [
    segment(point.index, a, b),
    segment(point.index, b, a),
  ]);
  const heads = new Map<string, TrainId>();
  for (const train of yard.trains) {
    const engine = motion.get(train.id)?.history.at(-1);
    if (!engine) continue;
    for (const key of [
      pathKey(engine),
      pathKey({ index: engine.index, from: engine.to, to: engine.from }),
    ]) {
      if (!heads.has(key)) heads.set(key, train.id);
    }
  }
  const visited = new Set<string>();
  for (const path of queue) {
    const key = pathKey(path);
    if (visited.has(key)) continue;
    visited.add(key);
    const match = heads.get(key);
    if (match !== undefined) return match;
    queue.push(...nextSegments(board, path));
  }
  return null;
}

/** Moves the engine `amount` further along the track, stopping short of a dead end as trains do. */
function pullForward(board: Board, history: readonly Segment[], progress: number, amount: number) {
  const pulled = [...history];
  let distance = progress + amount;
  for (let guard = 0; guard < 4 * MAX_CARS; guard += 1) {
    const last = pulled[pulled.length - 1];
    const next = onward(board, last);
    const limit = next ? last.length : deadEndStop(last);
    if (distance <= limit) return { history: pulled, progress: distance };
    if (!next) return null;
    distance -= last.length;
    pulled.push(next);
  }
  return null;
}

/** Adds a car to a train at its current position, extending the tail behind it. */
function couple(
  board: Board,
  cars: readonly Car[],
  current: TrainMotion,
  car: Car,
  insertAt: number,
): Refusal | { cars: readonly Car[]; history: readonly Segment[]; progress: number } {
  if (cars.length >= MAX_CARS) return "train-full";
  let path: Segment | null = current.history[current.history.length - 1];
  const visited = new Map<string, number>();
  let distance = 0;
  while (path) {
    const key = pathKey(path);
    if (visited.has(key)) {
      const circuit = distance - visited.get(key)!;
      if (circuit < (cars.length + 1) * CAR_GAP) return "loop-too-short";
      break;
    }
    visited.set(key, distance);
    distance += path.length;
    path = onward(board, path);
  }
  const coupled = cars.toSpliced(insertAt, 0, car);
  let history = extendTail(board, current.history, current.progress, coupled.length);
  let { progress } = current;
  const behind = lengthBehind(history, progress);
  if (!path) {
    const ahead = Math.max(0, distance - progress - END_CLEARANCE);
    if (behind + ahead < cars.length * CAR_GAP) return "needs-more-track";
  }
  // When the track behind runs out, pull the train forward so every car is on the rails.
  const shortfall = (coupled.length - 1) * CAR_GAP - behind;
  if (shortfall > 0) {
    const pulled = pullForward(board, history, progress, shortfall);
    if (!pulled) return "needs-more-track";
    ({ history, progress } = pulled);
  }
  return { cars: coupled, history, progress };
}

function addCar(yard: Yard, motion: Motion, car: Car, at: BoardPoint): EditResult {
  const { board } = yard;
  if (!board.grid[at.index]) return refuse("needs-track");
  const engine = isEngine(car.type);
  const hit = carAt(yard, motion, at, engine);
  const positions = carPositions(yard, motion);
  if (engine && !hit) {
    const placed = placeCar(board, at.index, at.x, at.y)!;
    const cars = carPositionsOn(placed.history, placed.progress, [car], board.cols);
    for (const other of positions.values()) {
      if (closestApproach(cars, other) < ENGINE_CLEARANCE) return refuse("engine-blocked");
    }
    const id = nextTrainId();
    const train: TrainSpec = {
      id,
      cars: [car],
      start: { path: toRefs(placed.history), progress: placed.progress },
    };
    const nextMotion = new Map(motion).set(id, { ...placed, held: false });
    return settle({ ...yard, trains: [...yard.trains, train] }, nextMotion);
  }
  const trainId = hit?.trainId ?? nearestTrain(yard, motion, at);
  if (trainId == null) return refuse("needs-engine");
  const index = yard.trains.findIndex((train) => train.id === trainId);
  const train = yard.trains[index];
  const current = motionOf(motion, trainId);
  // A tender dropped on a steam engine goes directly behind it.
  const insertAt =
    car.type === "tender" && hit && train.cars[hit.carIndex]?.type === "steam"
      ? hit.carIndex + 1
      : train.cars.length;
  const coupled = couple(board, train.cars, current, car, insertAt);
  if (typeof coupled === "string") return refuse(coupled);
  // Edits never create overlaps, so the longer train must stay clear of every other train.
  const before = positions.get(trainId)!;
  const after = carPositionsOn(coupled.history, coupled.progress, coupled.cars, board.cols);
  for (const [otherId, other] of positions) {
    if (otherId !== trainId && !overlaps(before, other) && overlaps(after, other))
      return refuse("square-occupied");
  }
  const start = extendTail(
    board,
    toSegments(train.start.path),
    train.start.progress,
    coupled.cars.length,
  );
  const nextTrain: TrainSpec = {
    ...train,
    cars: coupled.cars,
    start: { path: toRefs(start), progress: train.start.progress },
  };
  const nextMotion = new Map(motion).set(trainId, {
    history: coupled.history,
    progress: coupled.progress,
    held: current.held,
  });
  return settle({ ...yard, trains: yard.trains.with(index, nextTrain) }, nextMotion);
}

function removeCar(yard: Yard, motion: Motion, { trainId, carIndex }: CarRef): EditResult {
  const index = yard.trains.findIndex((train) => train.id === trainId);
  const train = yard.trains[index];
  if (!train?.cars[carIndex]) return refuse("no-change");
  const cars = train.cars.toSpliced(carIndex, 1);
  if (!cars.some((car) => isEngine(car.type))) {
    const nextMotion = new Map(motion);
    nextMotion.delete(trainId);
    return settle({ ...yard, trains: yard.trains.toSpliced(index, 1) }, nextMotion);
  }
  // The current position is kept, and the tail trims on the next step.
  const { path, progress } = train.start;
  const start = { path: toRefs(coveredPath(toSegments(path), progress, cars.length)), progress };
  return settle({ ...yard, trains: yard.trains.with(index, { ...train, cars, start }) }, motion);
}

function resize(yard: Yard, motion: Motion, { cols, rows }: GridSize): EditResult {
  const old = yard.board;
  if (old.cols === cols && old.rows === rows) return refuse("no-change");
  const used = new Set<number>();
  old.grid.forEach((tile, index) => tile && used.add(index));
  for (const train of yard.trains) {
    const current = motionOf(motion, train.id);
    for (const piece of coveredPath(current.history, current.progress, train.cars.length))
      used.add(piece.index);
    for (const piece of train.start.path) used.add(piece.index);
  }
  const cells = [...used].map((index) => cellAt(index, old.cols));
  const shift = [cols, rows].map((size, axis) => {
    if (!cells.length) return 0;
    let low = -Infinity;
    let high = Infinity;
    for (const cell of cells) {
      low = Math.max(low, -cell[axis]);
      high = Math.min(high, size - 1 - cell[axis]);
    }
    if (low > high) return null;
    const centered = Math.floor((size - (axis === 0 ? old.cols : old.rows)) / 2);
    return Math.min(high, Math.max(low, centered));
  });
  const [dx, dy] = shift;
  if (dx == null || dy == null) return refuse("too-big-for-size");
  const move = (index: number) => {
    const [x, y] = cellAt(index, old.cols);
    if (x + dx < 0 || x + dx >= cols || y + dy < 0 || y + dy >= rows) return -1;
    return indexAt(x + dx, y + dy, cols);
  };
  const remap = (index: number) => {
    const [x, y] = cellAt(index, cols);
    if (index < 0 || x - dx < 0 || x - dx >= old.cols || y - dy < 0 || y - dy >= old.rows)
      return -1;
    return indexAt(x - dx, y - dy, old.cols);
  };
  const grid: (Tile | null)[] = Array(cols * rows).fill(null);
  old.grid.forEach((tile, index) => {
    if (tile) grid[move(index)] = tile;
  });
  // Everything in use fits the new board, so every train keeps its position.
  const nextMotion = remapMotion(motion, move);
  const trains = yard.trains.map((train) => ({
    ...train,
    start: {
      ...train.start,
      path: train.start.path.map((piece) => ({ ...piece, index: move(piece.index) })),
    },
  }));
  const board: Board = { grid: grid as Grid, cols, rows };
  return settle({ ...yard, board, trains }, nextMotion, remap);
}

function replace(yard: Yard): EditResult {
  // Fresh ids mean positions from another yard can never be mistaken for this one's.
  const loaded = {
    ...yard,
    trains: yard.trains.map((train) => ({ ...train, id: nextTrainId() })),
  };
  return { ok: true, yard: loaded, motion: initialMotion(loaded) };
}

/** Applies an edit to a yard and the current positions. Pure: the inputs are never changed. */
export function applyEdit(yard: Yard, motion: Motion, edit: Edit): EditResult {
  switch (edit.type) {
    case "placeTrack":
      return placeTrack(yard, motion, edit.at, edit.track);
    case "moveTrack":
      return moveTrack(yard, motion, edit.from, edit.to);
    case "turn":
      return turn(yard, motion, edit.at);
    case "removeTrack":
      return removeTrack(yard, motion, edit.at);
    case "addCar":
      return addCar(yard, motion, edit.car, edit.at);
    case "removeCar":
      return removeCar(yard, motion, edit.car);
    case "setBackground":
      if (edit.background === yard.background) return refuse("no-change");
      return { ok: true, yard: { ...yard, background: edit.background }, motion };
    case "resize":
      return resize(yard, motion, edit.size);
    case "replace":
      return replace(edit.yard);
    case "rename":
      return { ok: true, yard: { ...yard, name: edit.name }, motion };
  }
}
