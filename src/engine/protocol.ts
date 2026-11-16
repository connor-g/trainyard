/**
 * Messages between the page and the yard worker. The worker owns the yard, the trains, undo and
 * all drawing; the page owns the DOM, pointer input, sound and the yard libraries.
 */

import type { Background, ColorName, StockType, TrackType } from "../catalog.ts";
import type { Edit, Refusal } from "../model/edits.ts";
import type { Tile } from "../railway.ts";
import type { SavedYard } from "../saves.ts";
import type { CallType } from "../sound.ts";

/**
 * A point on the board as a fraction of its width and height, 0–1 on each axis. The page
 * sends these so it never needs the grid to say where the pointer is.
 */
export type BoardFraction = readonly [u: number, v: number];

/** A grid square, by column and row. */
export type Square = readonly [column: number, row: number];

/** A piece being dragged from the palette. */
export type PalettePiece =
  | { readonly kind: "track"; readonly type: TrackType }
  | { readonly kind: "cars"; readonly type: StockType; readonly color: ColorName };

/** What a drag is carrying, as the page shows it. */
export type HeldPiece =
  | { readonly kind: "track"; readonly tile: Tile }
  | { readonly kind: "cars"; readonly type: StockType; readonly color: ColorName };

/** What the page shows outside the board. */
export interface Status {
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
  readonly background: Background;
  readonly canUndo: boolean;
  /** A yard was loaded, resized or undone, so keyboard focus returns to the first square. */
  readonly resetFocus: boolean;
}

/**
 * An edit as the page sends it. Yards cross between page and worker in their saved shape, so
 * train ids, which only the worker's yard uses, never leave the worker.
 */
export type PageEdit =
  | Exclude<Edit, { readonly type: "replace" }>
  | { readonly type: "replace"; readonly yard: SavedYard };

export type EditOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: Refusal };

/** A picture for the page, drawn by the worker. */
export type PictureSpec =
  | { readonly kind: "piece"; readonly piece: HeldPiece }
  | { readonly kind: "ground"; readonly background: Background }
  | { readonly kind: "yard"; readonly yard: SavedYard };

/** Messages that expect an answer, with what the answer holds. */
export interface Requests {
  /** Applies an edit to the yard. A refused edit is also reported with a `refused` message. */
  edit: { readonly message: { readonly edit: PageEdit }; readonly reply: EditOutcome };
  /** Picks up a piece from the palette or the board; null for an empty square. */
  grab: {
    readonly message: { readonly from: PalettePiece | BoardFraction };
    readonly reply: HeldPiece | null;
  };
  picture: { readonly message: { readonly spec: PictureSpec }; readonly reply: Blob };
  /** The current yard, to save it. */
  yard: { readonly message: {}; readonly reply: SavedYard };
  /** The built-in yards. */
  builtIns: { readonly message: {}; readonly reply: readonly SavedYard[] };
}
export type RequestType = keyof Requests;

export type Request = {
  [T in RequestType]: { readonly type: T; readonly id: number } & Requests[T]["message"];
}[RequestType];

export type ToWorker =
  | Request
  /** Hands over the board canvas. */
  | { readonly type: "init"; readonly canvas: OffscreenCanvas }
  /** The board's size in device pixels. */
  | { readonly type: "resize"; readonly width: number; readonly height: number }
  | { readonly type: "undo" }
  | { readonly type: "speed"; readonly speed: number }
  /** The held piece moved; trains wait while it does. Null when off the board. */
  | { readonly type: "drag"; readonly at: BoardFraction | null }
  /** The held piece was let go: dropped, tapped or put on the remove zone. */
  | {
      readonly type: "release";
      readonly at: BoardFraction | null;
      readonly remove: boolean;
    }
  /** The drag was cancelled. */
  | { readonly type: "cancel" }
  /** Keyboard focus moved to a square, or left the board; it may also act on that square. */
  | {
      readonly type: "keyboard";
      readonly square: Square | null;
      readonly action?: "tap" | "remove";
    };

export type FromWorker =
  | {
      readonly type: "reply";
      readonly id: number;
      readonly value: Requests[RequestType]["reply"];
    }
  /** A request failed in the worker; the page rejects it with this message. */
  | { readonly type: "failed"; readonly id: number; readonly error: string }
  | { readonly type: "status"; readonly status: Status }
  | { readonly type: "refused"; readonly reason: Refusal }
  /** The engine types now rolling, for the rolling sound. */
  | { readonly type: "rolling"; readonly engines: readonly StockType[] }
  /** A horn or the station bell. */
  | { readonly type: "call"; readonly sound: CallType };
