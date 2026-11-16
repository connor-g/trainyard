import type { Background, Board, Car, Segment, SegmentRef } from "../railway.ts";

export type { Board, SegmentRef } from "../railway.ts";

/** What the player built. Immutable; changes only on edits; undoable; what gets saved. */
export interface Yard {
  readonly name: string;
  readonly board: Board;
  readonly background: Background;
  readonly trains: readonly TrainSpec[];
}

/** Unique for the whole session. Assigned when a yard is created or loaded; never saved. */
export type TrainId = number & { readonly __brand: "TrainId" };

export interface TrainSpec {
  readonly id: TrainId;
  /** Engine first. */
  readonly cars: readonly Car[];
  /** Where the train sits when the yard starts. */
  readonly start: StartPath;
}

/** The track a train covers when the yard starts, engine last, and the engine's distance along the last segment. */
export interface StartPath {
  readonly path: readonly SegmentRef[];
  readonly progress: number;
}

/** Where the trains are right now. Runtime only; replaced every frame; not undoable; never saved. Every train has an entry. */
export type Motion = ReadonlyMap<TrainId, TrainMotion>;

export interface TrainMotion {
  readonly history: readonly Segment[];
  readonly progress: number;
  /** Placed on top of another train; holds still until no other train overlaps it. */
  readonly held: boolean;
}

/** A point on the board: a square and the position within it, 0–1 on each axis. */
export interface BoardPoint {
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

export interface CarRef {
  readonly trainId: TrainId;
  readonly carIndex: number;
}

let lastTrainId = 0;
/** Ids are only ever handed out, never reused, so they stay unique for the whole session. */
export const nextTrainId = () => ++lastTrainId as TrainId;
