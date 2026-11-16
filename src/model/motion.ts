import { pathKey } from "../railway.ts";
import type { CarPosition, Segment } from "../railway.ts";
import {
  CAR_GAP,
  carPositionsOn,
  extendTail,
  isValidPath,
  lengthBehind,
  overlaps,
  toSegments,
  validSuffix,
} from "./train.ts";
import type { Motion, TrainId, TrainMotion, TrainSpec, Yard } from "./types.ts";

const EPSILON = 1e-9;

/** Every train at its start, in yard order. A train that overlaps an earlier one starts held. */
export function initialMotion(yard: Yard): Motion {
  const motion = new Map<TrainId, TrainMotion>();
  const placed: CarPosition[][] = [];
  for (const train of yard.trains) {
    const history = toSegments(train.start.path);
    const { progress } = train.start;
    const cars = carPositionsOn(history, progress, train.cars, yard.board.cols);
    motion.set(train.id, {
      history,
      progress,
      held: placed.some((other) => overlaps(cars, other)),
    });
    placed.push(cars);
  }
  return motion;
}

/**
 * Places every train of the yard using the first option that works:
 * 1. keep its current position, if that is still a valid path for its cars;
 * 2. keep its position and extend the tail, if that fits without overlapping another train;
 * 3. return to its start, held if another train is on it.
 * Positions of trains that are no longer in the yard are dropped.
 */
export function reconcile(yard: Yard, motion: Motion): Motion {
  const { board } = yard;
  const placed = new Map<TrainId, TrainMotion>();
  const cars = new Map<TrainId, CarPosition[]>();
  const place = (train: TrainSpec, next: TrainMotion) => {
    placed.set(train.id, next);
    cars.set(train.id, carPositionsOn(next.history, next.progress, train.cars, board.cols));
  };
  const clashes = (train: TrainSpec, next: TrainMotion) => {
    const positions = carPositionsOn(next.history, next.progress, train.cars, board.cols);
    return [...cars.values()].some((other) => overlaps(positions, other));
  };

  const shortTrains: [TrainSpec, readonly Segment[], TrainMotion][] = [];
  for (const train of yard.trains) {
    const current = motion.get(train.id);
    if (!current) continue;
    const history = validSuffix(board, current.history);
    const head = history.at(-1);
    // The engine's own segment has to survive, or the train has no position on this board.
    if (history.at(-1) !== current.history.at(-1) || !head) continue;
    if (current.progress < -EPSILON || current.progress > head.length + EPSILON) continue;
    if (lengthBehind(history, current.progress) + EPSILON >= (train.cars.length - 1) * CAR_GAP) {
      place(train, history === current.history ? current : { ...current, history });
    } else {
      shortTrains.push([train, history, current]);
    }
  }
  for (const [train, history, current] of shortTrains) {
    const extended = extendTail(board, history, current.progress, train.cars.length);
    const next = { ...current, history: extended };
    if (isValidPath(board, extended, current.progress, train.cars.length) && !clashes(train, next))
      place(train, next);
  }
  for (const train of yard.trains) {
    if (placed.has(train.id)) continue;
    const history = toSegments(train.start.path);
    const start = { history, progress: train.start.progress, held: false };
    place(train, { ...start, held: clashes(train, start) });
  }
  // Keep yard order, so trains are drawn and stepped in the same order as before.
  return new Map(yard.trains.map((train) => [train.id, motionOf(placed, train.id)]));
}

/** A train's motion. Every train in the yard has one, so a missing entry is a bug, reported here. */
export function motionOf(motion: Motion, id: TrainId): TrainMotion {
  const current = motion.get(id);
  if (!current) throw new Error(`Train ${id} has no motion`);
  return current;
}

/** Compares positions by segment keys, progress and held, not by object identity. */
export function motionEquals(a: Motion, b: Motion): boolean {
  if (a.size !== b.size) return false;
  for (const [id, first] of a) {
    const second = b.get(id);
    if (!second) return false;
    if (first.progress !== second.progress || first.held !== second.held) return false;
    if (first.history.length !== second.history.length) return false;
    for (const [i, piece] of first.history.entries()) {
      if (pathKey(piece) !== pathKey(second.history[i])) return false;
    }
  }
  return true;
}

/**
 * Moves every position onto another board with `remap` (new index → previous index, or -1).
 * History that falls off the grid is dropped; a train whose engine falls off loses its position.
 */
export function remapMotion(motion: Motion, remap: (index: number) => number): Motion {
  const next = new Map<TrainId, TrainMotion>();
  for (const [id, current] of motion) {
    const history = current.history.map((piece) => ({ ...piece, index: remap(piece.index) }));
    const kept = history.slice(history.findLastIndex((piece) => piece.index === -1) + 1);
    if (kept.length) next.set(id, { ...current, history: kept });
  }
  return next;
}
