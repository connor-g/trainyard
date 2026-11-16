import { cellAt, isSwitch, switchBranch, underTunnelRoof } from "../railway.ts";
import type { Board, CarPosition, Tile } from "../railway.ts";
import { carPositionsOn, coveredPath, isValidPath, toSegments } from "./train.ts";
import type { BoardPoint, CarRef, Motion, StartPath, TrainId, Yard } from "./types.ts";

export { underTunnelRoof } from "../railway.ts";

export function carPositions(
  yard: Yard,
  motion: Motion,
): ReadonlyMap<TrainId, readonly CarPosition[]> {
  const positions = new Map<TrainId, readonly CarPosition[]>();
  for (const train of yard.trains) {
    const current = motion.get(train.id);
    if (!current) continue;
    positions.set(
      train.id,
      carPositionsOn(current.history, current.progress, train.cars, yard.board.cols),
    );
  }
  return positions;
}

/** Every square on each train's covered path, from its last car to its engine. */
export function occupiedSquares(yard: Yard, motion: Motion): ReadonlySet<number> {
  const squares = new Set<number>();
  for (const train of yard.trains) {
    const current = motion.get(train.id);
    if (!current) continue;
    for (const piece of coveredPath(current.history, current.progress, train.cars.length))
      squares.add(piece.index);
  }
  return squares;
}

/**
 * The car under a board point, skipping cars hidden under tunnel roofs. With `bySquare`, a car
 * anywhere on the point's square counts when no car is close to the point itself.
 */
export function carAt(
  yard: Yard,
  motion: Motion,
  point: BoardPoint,
  bySquare = false,
): CarRef | null {
  const [column, row] = cellAt(point.index, yard.board.cols);
  const x = column + point.x;
  const y = row + point.y;
  if (underTunnelRoof(yard.board, x, y)) return null;
  let result: CarRef | null = null;
  let distance = 0.42;
  for (const [trainId, cars] of carPositions(yard, motion)) {
    for (const [carIndex, car] of cars.entries()) {
      const next = Math.hypot(x - car.x, y - car.y);
      if (next <= distance || (bySquare && car.index === point.index && !result)) {
        distance = next;
        result = { trainId, carIndex };
      }
    }
  }
  return result;
}

/** The tile as drawn: a switch shows the branch its connections select. */
export function visibleTile({ board }: { readonly board: Board }, index: number): Tile | null {
  const tile = board.grid[index];
  if (!isSwitch(tile)) return tile ?? null;
  const branch = switchBranch(board, index, tile);
  return branch === tile.branch ? tile : { ...tile, branch };
}

/** Whether the start path is valid on the board for a train of `cars` cars. */
export function isValidStart(board: Board, cars: number, start: StartPath) {
  return isValidPath(board, toSegments(start.path), start.progress, cars);
}
