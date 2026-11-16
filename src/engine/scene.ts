/** What the engine hands its renderer, and the renderer it draws through. */
import type { Board, CarPosition } from "../railway.ts";
import type { CarRef, Motion, TrainId, Yard } from "../model/types.ts";
import type { PictureSpec } from "./protocol.ts";

/** The board as the scene layer shows it: a drag previews its edit, and the square under it is marked. */
export interface Scene {
  readonly board: Board;
  readonly highlight: {
    readonly column: number;
    readonly row: number;
    readonly index: number;
    /** Whether a drop or tap here would do something. */
    readonly valid: boolean;
    /** Where a held car would land. */
    readonly car: CarPosition | null;
  } | null;
}

/** What changes every frame. */
export interface Frame {
  readonly yard: Yard;
  readonly motion: Motion;
  readonly movingTrains: ReadonlySet<TrainId>;
  readonly speed: number;
}

export interface Renderer {
  /** Sets the board's size in device pixels and redraws it right away. */
  resize(width: number, height: number, scene: () => Scene, frame: Frame): void;
  /** The scenery, and so everything over it, needs redrawing. */
  groundChanged(): void;
  /** The track or the drag preview needs redrawing. */
  sceneChanged(): void;
  /** The trains need redrawing. */
  frameChanged(): void;
  /** Whether the next frame must be drawn: something changed, or steam or a crane is moving. */
  readonly needsFrame: boolean;
  /** Draws the frame, asking for the scene only when it must be redrawn. */
  render(scene: () => Scene, frame: Frame, now: number, emitSmoke: boolean): void;
  swingCrane(car: CarRef, now: number): void;
  /** Clears steam and crane swings, for a newly loaded or blank yard. */
  resetEffects(): void;
  picture(spec: PictureSpec): Promise<Blob>;
}
