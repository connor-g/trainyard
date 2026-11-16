/** How a placed piece turns to meet its neighbours, and what tapping a piece does. */

import { TRACK } from "./catalog.ts";
import type { TrackType } from "./catalog.ts";
import { ENDS, OPPOSITE, hasPort, isSwitch, neighbor } from "./railway.ts";
import type { Board, Port, Tile } from "./railway.ts";

type Orientation = Pick<Tile, "type" | "turn"> & { branch?: boolean };

function orientations(type: TrackType): Tile[] {
  const paths: [Port, Port][] = TRACK[type].paths;
  const [first, second] = paths[0];
  const straight = paths.length === 1 && OPPOSITE[first] === second;
  const turns = straight ? [0, 1] : type === "cross" ? [0] : [0, 1, 2, 3];
  return turns.map((turn) => ({ type, turn, branch: false }));
}

function connectedPorts(board: Board, index: number, tile: Orientation) {
  return ENDS.flatMap((_, port) =>
    hasPort(tile, port) && hasPort(board.grid[neighbor(board, index, port)], OPPOSITE[port])
      ? [port]
      : [],
  );
}

export type TrackEdit = [index: number, tile: Tile];

export function fitTrack(
  board: Board,
  index: number,
  type: TrackType,
  occupied: ReadonlySet<number> = new Set(),
  original: Tile | null = null,
): TrackEdit[] {
  const adjacent = ENDS.map((_, port): { index: number; tile?: Tile | null; rotated?: Tile } => {
    const nextIndex = neighbor(board, index, port);
    const tile = board.grid[nextIndex];
    const entry = OPPOSITE[port];
    if (!tile || hasPort(tile, entry)) return { index: nextIndex, tile };
    if (occupied.has(nextIndex) || connectedPorts(board, nextIndex, tile).length)
      return { index: nextIndex };
    const rotated = orientations(tile.type).find((option) => hasPort(option, entry));
    return { index: nextIndex, rotated };
  });
  let bestScore = -1;
  let best: TrackEdit[] = [];
  for (const orientation of orientations(type)) {
    const tile = original ? { ...original, turn: orientation.turn } : orientation;
    const edits: TrackEdit[] = [[index, tile]];
    let score = 0;
    adjacent.forEach((next, port) => {
      if (!hasPort(tile, port)) return;
      if (next.tile) score += 5;
      if (next.rotated) {
        score += 1;
        edits.push([next.index, next.rotated]);
      }
    });
    if (score > bestScore || (score === bestScore && tile.turn === original?.turn)) {
      bestScore = score;
      best = edits;
    }
  }
  return best;
}

export function rotateTrack(board: Board, index: number): Tile | null {
  const tile = board.grid[index];
  if (!tile) return null;
  const options = orientations(tile.type);
  const fullyConnected = isSwitch(tile) && connectedPorts(board, index, tile).length === 3;
  const connected = options.filter(
    (option) => connectedPorts(board, index, option).length >= (fullyConnected ? 3 : 1),
  );
  const valid = connected.length ? connected : options;
  const turn = tile.turn % options.length;
  const next = valid.find((option) => option.turn > turn) ?? valid[0];
  if (next.turn !== turn) return { ...tile, turn: next.turn };
  return fullyConnected ? { ...tile, branch: !tile.branch } : null;
}
