/** Geometry shared by the model: where cars sit along a path, and whether a path is valid. */

import type { Car } from "../catalog.ts";
import { isRoute, leadsInto, onward, pathKey, position, routesAt, segment } from "../railway.ts";
import type { Board, CarPosition, Segment, SegmentRef } from "../railway.ts";

/** Distance between the centres of neighbouring cars. */
export const CAR_GAP = 0.7;
export const MAX_CARS = 24;
/** A train stops before its engine comes this close to another train's cars. */
export const COLLISION = 0.58;
/** A new engine needs this much room from every other train's cars. */
export const ENGINE_CLEARANCE = 0.66;
/** How far short of a dead end a train stops. */
export const END_CLEARANCE = 0.29;
const EPSILON = 1e-9;

export const toSegments = (path: readonly SegmentRef[]): Segment[] =>
  path.map(({ index, from, to }) => segment(index, from, to));

export const toRefs = (path: readonly SegmentRef[]): SegmentRef[] =>
  path.map(({ index, from, to }) => ({ index, from, to }));

/** How far along a segment that ends the line a train stops: short of the end, but not before its middle. */
export const deadEndStop = (path: Segment) =>
  path.length - Math.min(END_CLEARANCE, path.length / 2);

/** The track available behind the engine, from the start of the path to the engine. */
export function lengthBehind(history: readonly Segment[], progress: number) {
  let total = progress;
  for (let i = 0; i < history.length - 1; i += 1) total += history[i].length;
  return total;
}

/** Index of the segment under the last car. */
export function lastCarSegment(history: readonly Segment[], progress: number, cars: number) {
  let index = history.length - 1;
  let distance = progress - (cars - 1) * CAR_GAP;
  while (index > 0 && distance < 0) {
    index -= 1;
    distance += history[index].length;
  }
  return index;
}

/** The part of a path the cars cover, from the last car to the engine. */
export function coveredPath(history: readonly Segment[], progress: number, cars: number) {
  return history.slice(lastCarSegment(history, progress, cars));
}

export function carPositionsOn(
  history: readonly Segment[],
  progress: number,
  cars: readonly Car[],
  cols: number,
): CarPosition[] {
  const positions: CarPosition[] = [];
  let pathIndex = history.length - 1;
  let distance = progress;
  for (const car of cars) {
    while (distance < 0 && pathIndex > 0) {
      pathIndex -= 1;
      distance += history[pathIndex].length;
    }
    if (distance < 0) break;
    positions.push({ ...position(history[pathIndex], distance, cols), ...car });
    distance -= CAR_GAP;
  }
  return positions;
}

/** The longest end of the path in which every segment is a route and leads into the next. */
export function validSuffix<T extends SegmentRef>(board: Board, path: readonly T[]): readonly T[] {
  let start = path.length - 1;
  if (start < 0 || !isRoute(board, path[start])) return [];
  while (
    start > 0 &&
    isRoute(board, path[start - 1]) &&
    leadsInto(board, path[start - 1], path[start])
  )
    start -= 1;
  return start === 0 ? path : path.slice(start);
}

/**
 * A path is valid on a board when every segment is a route on its tile, each leads into the next,
 * the engine's progress lies on the last segment, and the path is long enough for every car.
 * This never depends on how switches are set.
 */
export function isValidPath(
  board: Board,
  history: readonly Segment[],
  progress: number,
  cars: number,
) {
  if (!history.length || validSuffix(board, history).length !== history.length) return false;
  const last = history[history.length - 1];
  if (!(progress >= -EPSILON && progress <= last.length + EPSILON)) return false;
  return lengthBehind(history, progress) + EPSILON >= (cars - 1) * CAR_GAP;
}

/** Extends the path backwards along the track until it is long enough for `cars` cars, or the track runs out. */
export function extendTail(
  board: Board,
  history: readonly Segment[],
  progress: number,
  cars: number,
): Segment[] {
  const extended = [...history];
  let available = lengthBehind(history, progress);
  const seen = new Set(history.map(pathKey));
  while (available < (cars - 1) * CAR_GAP) {
    const first = extended[0];
    const previous = onward(board, segment(first.index, first.to, first.from));
    if (!previous) break;
    const path = segment(previous.index, previous.to, previous.from);
    const key = pathKey(path);
    if (seen.has(key)) break;
    seen.add(key);
    extended.unshift(path);
    available += path.length;
  }
  return extended;
}

/** Where a single car dropped at (x, y) within the square at `index` sits. */
export function placeCar(
  board: Board,
  index: number,
  x = 0.5,
  y = 0.5,
  reverse = false,
): { history: Segment[]; progress: number } | null {
  const tile = board.grid[index];
  if (!tile) return null;
  const routes = routesAt(tile, x, y);
  const paths = routes.map(([from, to]) => segment(index, from, to));
  const reversed = routes.map(([from, to]) => segment(index, to, from));
  const candidates = reverse ? [...reversed, ...paths] : [...paths, ...reversed];
  const path = candidates.find((candidate) => onward(board, candidate)) ?? paths[0];
  return { history: [path], progress: path.length / 2 };
}

export function closestApproach(a: readonly CarPosition[], b: readonly CarPosition[]) {
  let closest = Infinity;
  for (const first of a) {
    for (const second of b) {
      closest = Math.min(closest, Math.hypot(first.x - second.x, first.y - second.y));
    }
  }
  return closest;
}

/** Two trains overlap when any of their cars are within collision distance. */
export const overlaps = (a: readonly CarPosition[], b: readonly CarPosition[]) =>
  closestApproach(a, b) < COLLISION;
