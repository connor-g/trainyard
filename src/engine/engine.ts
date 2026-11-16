/**
 * The yard engine: the yard, the trains, undo, and what a drag or tap does. It runs in the yard
 * worker, takes messages from the page and draws through a renderer. Nothing here touches a
 * canvas, so it runs in tests too.
 */
import { indexAt, isEngine } from "../railway.ts";
import type { Board, Car, CarPosition, ColorName, StockType, Tile, TrackType } from "../railway.ts";
import { applyEdit } from "../model/edits.ts";
import type { Edit, EditResult } from "../model/edits.ts";
import { carAt } from "../model/queries.ts";
import { carPositionsOn, placeCar } from "../model/train.ts";
import type { BoardPoint, CarRef, Motion, TrainId, Yard } from "../model/types.ts";
import { createStore } from "../store.ts";
import { sampleLayout } from "../presets.ts";
import type {
  BoardFraction,
  FromWorker,
  HeldPiece,
  PictureSpec,
  Request,
  RequestType,
  Requests,
  Square,
  ToWorker,
} from "./protocol.ts";

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

/** A grid square under the pointer or keyboard focus, with the exact point inside it. */
interface Cell {
  x: number;
  y: number;
  column: number;
  row: number;
  index: number;
}

type PaletteItem =
  | { kind: "track"; type: TrackType; color?: undefined; tile?: undefined; train?: undefined }
  | { kind: "cars"; type: StockType; color: ColorName; tile?: undefined; train?: undefined };
interface BoardCar extends Car {
  kind: "board";
  index: number;
  train: TrainId;
  carIndex: number;
  tile?: undefined;
}
interface BoardTile {
  kind: "board";
  index: number;
  tile: Tile;
  type: TrackType;
  color?: undefined;
  train?: undefined;
}
interface BoardSquare {
  kind: "board";
  index: number;
  tile: null;
  type?: undefined;
  color?: undefined;
  train?: undefined;
}
type BoardItem = BoardCar | BoardTile | BoardSquare;
type Item = PaletteItem | BoardItem;
type TrackMove = Extract<PaletteItem, { kind: "track" }> | BoardTile;

const NO_TRAINS: ReadonlySet<TrainId> = new Set();

export function createEngine(
  renderer: Renderer,
  post: (message: FromWorker) => void,
  clock: () => number = () => performance.now(),
) {
  const store = createStore(sampleLayout());
  let speed = 1;
  let held: { item: Item; moved: boolean } | null = null;
  let hover: Cell | null = null;
  let movingTrains = NO_TRAINS;
  let rolling = "";
  let lastFrame: number | undefined;

  function postStatus(resetFocus: boolean) {
    const { yard } = store;
    post({
      type: "status",
      status: {
        name: yard.name,
        cols: yard.board.cols,
        rows: yard.board.rows,
        background: yard.background,
        canUndo: store.canUndo,
        resetFocus,
      },
    });
  }

  store.subscribe(({ yard, previous, edit }) => {
    if (edit?.type === "replace") renderer.resetEffects();
    const resetFocus = !edit || edit.type === "replace" || edit.type === "resize";
    if (resetFocus) hover = null;
    if (
      yard.background !== previous.background ||
      yard.board.cols !== previous.board.cols ||
      yard.board.rows !== previous.board.rows
    ) {
      renderer.groundChanged();
    } else if (yard.board !== previous.board) {
      renderer.sceneChanged();
    } else {
      renderer.frameChanged();
    }
    postStatus(resetFocus);
  });

  function cellAt(at: BoardFraction | null): Cell | null {
    if (!at) return null;
    const { cols, rows } = store.yard.board;
    const x = at[0] * cols;
    const y = at[1] * rows;
    const column = Math.floor(x);
    const row = Math.floor(y);
    if (column < 0 || column >= cols || row < 0 || row >= rows) return null;
    return { x, y, column, row, index: indexAt(column, row, cols) };
  }

  function squareCell([column, row]: Square): Cell {
    const { cols } = store.yard.board;
    return { column, row, x: column + 0.5, y: row + 0.5, index: indexAt(column, row, cols) };
  }

  const boardPoint = (cell: Cell): BoardPoint => ({
    index: cell.index,
    x: cell.x - cell.column,
    y: cell.y - cell.row,
  });

  function movesTrack(item: Item | undefined): item is TrackMove {
    return item?.kind === "track" || Boolean(item?.tile);
  }

  function trackEdit(item: TrackMove, index: number): Edit {
    return item.tile
      ? { type: "moveTrack", from: item.index, to: index }
      : { type: "placeTrack", at: index, track: item.type };
  }

  function dispatch(edit: Edit) {
    const result = store.dispatch(edit);
    if (!result.ok) post({ type: "refused", reason: result.reason });
  }

  function boardItem(cell: Cell): BoardItem {
    const hit = carAt(store.yard, store.motion, boardPoint(cell), true);
    const train = hit && store.yard.trains.find((train) => train.id === hit.trainId);
    if (hit && train) {
      return {
        kind: "board",
        index: cell.index,
        train: train.id,
        carIndex: hit.carIndex,
        ...train.cars[hit.carIndex],
      };
    }
    const tile = store.yard.board.grid[cell.index];
    return tile
      ? { kind: "board", index: cell.index, tile, type: tile.type }
      : { kind: "board", index: cell.index, tile: null };
  }

  function dropPiece(cell: Cell, item: TrackMove | Extract<PaletteItem, { kind: "cars" }>) {
    if (movesTrack(item)) {
      if (item.tile && cell.index === item.index) return;
      return dispatch(trackEdit(item, cell.index));
    }
    dispatch({ type: "addCar", car: { type: item.type, color: item.color }, at: boardPoint(cell) });
  }

  function removePiece(item: BoardItem) {
    if (item.train !== undefined) {
      return dispatch({ type: "removeCar", car: { trainId: item.train, carIndex: item.carIndex } });
    }
    dispatch({ type: "removeTrack", at: item.index });
  }

  function tapBoard(cell: Cell, item: BoardItem = boardItem(cell)) {
    if (item.train !== undefined && isEngine(item.type)) post({ type: "call", sound: item.type });
    else if (item.train !== undefined && item.type === "crane") {
      renderer.swingCrane({ trainId: item.train, carIndex: item.carIndex }, clock());
    } else if (store.yard.board.grid[cell.index]) dispatch({ type: "turn", at: cell.index });
  }

  /** What the page shows while the item is held. */
  function heldPiece(item: Item): HeldPiece | null {
    if (item.kind === "board" && !item.type) return null;
    if (item.kind === "cars" || item.train !== undefined) {
      return { kind: "cars", type: item.type as StockType, color: item.color! };
    }
    return { kind: "track", tile: item.tile ?? { type: item.type!, turn: 0, branch: false } };
  }

  function scene(): Scene {
    const item = held?.item;
    const trackDrop = hover && movesTrack(item) ? item : null;
    // A drag previews the edit without committing it.
    const preview: EditResult | null =
      trackDrop && hover
        ? applyEdit(store.yard, store.motion, trackEdit(trackDrop, hover.index))
        : null;
    const board = preview?.ok ? preview.yard.board : store.yard.board;
    if (!hover) return { board, highlight: null };
    const { column, row, index } = hover;
    const valid = trackDrop
      ? Boolean(preview?.ok) || (preview?.ok === false && preview.reason === "no-change")
      : Boolean(board.grid[index]);
    let car: CarPosition | null = null;
    if (valid && item?.kind === "cars") {
      const placed = placeCar(board, index, hover.x - column, hover.y - row)!;
      [car] = carPositionsOn(
        placed.history,
        placed.progress,
        [{ type: item.type, color: item.color }],
        board.cols,
      );
    }
    return { board, highlight: { column, row, index, valid, car } };
  }

  const frameState = (): Frame => ({
    yard: store.yard,
    motion: store.motion,
    movingTrains,
    speed,
  });

  function setRolling(engines: ReadonlySet<StockType>) {
    const key = [...engines].sort().join();
    if (key === rolling) return;
    rolling = key;
    post({ type: "rolling", engines: [...engines] });
  }

  function reply<T extends RequestType>(id: number, value: Requests[T]["reply"]) {
    post({ type: "reply", id, value });
  }

  function answer(request: Request) {
    switch (request.type) {
      case "edit": {
        const result = store.dispatch(request.edit);
        return reply<"edit">(request.id, result.ok ? { ok: true } : result);
      }
      case "grab": {
        const { from } = request;
        if (held) return reply<"grab">(request.id, null);
        let item: Item | null;
        if ("kind" in from) {
          item = { ...from };
        } else {
          const cell = cellAt(from);
          item = cell && boardItem(cell);
        }
        if (item) held = { item, moved: false };
        return reply<"grab">(request.id, item && heldPiece(item));
      }
      case "picture":
        return void renderer.picture(request.spec).then((blob) => reply(request.id, blob));
      case "yard":
        return reply<"yard">(request.id, store.yard);
    }
  }

  function release(at: BoardFraction | null, remove: boolean) {
    if (!held) return;
    const { item, moved } = held;
    held = null;
    hover = null;
    const target = cellAt(at);
    if (item.kind === "board") {
      if (moved && remove) removePiece(item);
      else if (moved && target && item.tile) dropPiece(target, item);
      else if (!moved && target?.index === item.index) tapBoard(target, item);
    } else if (target && moved) {
      dropPiece(target, item);
    }
    renderer.sceneChanged();
  }

  return {
    get yard() {
      return store.yard;
    },
    get motion() {
      return store.motion;
    },

    handle(message: ToWorker) {
      switch (message.type) {
        case "init":
          return;
        case "resize":
          return renderer.resize(message.width, message.height, scene, frameState());
        case "undo":
          return store.undo();
        case "speed":
          speed = message.speed;
          return;
        case "drag": {
          if (!held) return;
          held.moved = true;
          const { item } = held;
          // Cars on the board are lifted off it, so they mark no square.
          hover = item.kind === "board" && !item.tile ? null : cellAt(message.at);
          return renderer.sceneChanged();
        }
        case "release":
          return release(message.at, message.remove);
        case "cancel":
          held = null;
          hover = null;
          return renderer.sceneChanged();
        case "keyboard": {
          hover = message.square && squareCell(message.square);
          if (hover && message.action === "remove") removePiece(boardItem(hover));
          else if (hover && message.action === "tap") tapBoard(hover);
          return renderer.sceneChanged();
        }
        default:
          return answer(message);
      }
    },

    /** Advances the trains and draws a frame if anything changed. */
    frame(now = clock()) {
      const seconds = lastFrame === undefined ? 0 : Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      // Trains stay paused while something is being dragged.
      const moving = Boolean(speed && store.yard.trains.length && !held?.moved);
      if (moving) {
        const events = store.tick(seconds, speed);
        movingTrains = events.movingTrains;
        setRolling(events.movingEngines);
        for (let i = 0; i < events.stationArrivals; i += 1)
          post({ type: "call", sound: "station" });
      } else {
        movingTrains = NO_TRAINS;
        setRolling(new Set());
      }
      if (moving || renderer.needsFrame) renderer.render(scene, frameState(), now, moving);
    },

    /** Tells the page what to show, once it is listening. */
    start() {
      postStatus(true);
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;
