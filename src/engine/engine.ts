/**
 * The yard engine: the yard, the trains, undo, and what a drag or tap does. It runs in the yard
 * worker, takes messages from the page and draws through a renderer. Nothing here touches a
 * canvas, so it runs in tests too.
 */

import { isEngine } from "../catalog.ts";
import type { Car, StockType, TrackType } from "../catalog.ts";
import { applyEdit } from "../model/edits.ts";
import type { Edit, EditResult } from "../model/edits.ts";
import { carAt } from "../model/queries.ts";
import { carPositionsOn, placeCar } from "../model/train.ts";
import type { BoardPoint, CarRef, TrainId, Yard } from "../model/types.ts";
import { sampleLayout, scenicPresets } from "../presets.ts";
import { indexAt } from "../railway.ts";
import type { CarPosition, Tile } from "../railway.ts";
import { fromSaved, toSaved } from "../saves.ts";
import { createStore } from "../store.ts";
import type {
  BoardFraction,
  FromWorker,
  HeldPiece,
  PageEdit,
  Request,
  RequestType,
  Requests,
  Square,
  ToWorker,
} from "./protocol.ts";
import type { Frame, Renderer, Scene } from "./scene.ts";

export type { Frame, Renderer, Scene } from "./scene.ts";

/** A grid square under the pointer or keyboard focus, with the exact point inside it. */
interface Cell {
  x: number;
  y: number;
  column: number;
  row: number;
  index: number;
}

/** Something picked up: a new piece from the palette, or a piece already on the board. */
type Grabbed =
  | { readonly kind: "new-track"; readonly type: TrackType }
  | { readonly kind: "new-car"; readonly car: Car }
  | { readonly kind: "board-track"; readonly index: number; readonly tile: Tile }
  | { readonly kind: "board-car"; readonly index: number; readonly car: Car; readonly ref: CarRef };
type OnBoard = Extract<Grabbed, { kind: "board-track" | "board-car" }>;
type TrackPiece = Extract<Grabbed, { kind: "new-track" | "board-track" }>;
type Droppable = Exclude<Grabbed, { kind: "board-car" }>;

const isTrack = (item: Grabbed | undefined): item is TrackPiece =>
  item?.kind === "new-track" || item?.kind === "board-track";

const toEdit = (edit: PageEdit): Edit =>
  edit.type === "replace" ? { type: "replace", yard: fromSaved(edit.yard) } : edit;

export interface EngineOptions {
  /** The yard to start with; Meadow Loop by default. */
  readonly initial?: Yard;
  readonly clock?: () => number;
}

const NO_TRAINS: ReadonlySet<TrainId> = new Set();

export function createEngine(
  renderer: Renderer,
  post: (message: FromWorker) => void,
  { initial = sampleLayout(), clock = () => performance.now() }: EngineOptions = {},
) {
  const store = createStore(initial);
  let speed = 1;
  let held: { item: Grabbed; moved: boolean } | null = null;
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

  function trackEdit(item: TrackPiece, index: number): Edit {
    return item.kind === "board-track"
      ? { type: "moveTrack", from: item.index, to: index }
      : { type: "placeTrack", at: index, track: item.type };
  }

  /** Applies an edit, telling the page if it was refused. */
  function dispatch(edit: Edit): EditResult {
    const result = store.dispatch(edit);
    if (!result.ok) post({ type: "refused", reason: result.reason });
    return result;
  }

  /** The car or track on a square; a car wins over the track under it. */
  function onBoard(cell: Cell): OnBoard | null {
    const hit = carAt(store.yard, store.motion, boardPoint(cell), true);
    const train = hit && store.yard.trains.find((train) => train.id === hit.trainId);
    if (hit && train) {
      return { kind: "board-car", index: cell.index, car: train.cars[hit.carIndex], ref: hit };
    }
    const tile = store.yard.board.grid[cell.index];
    return tile ? { kind: "board-track", index: cell.index, tile } : null;
  }

  function dropPiece(cell: Cell, item: Droppable) {
    if (item.kind === "new-car") {
      dispatch({ type: "addCar", car: item.car, at: boardPoint(cell) });
    } else if (item.kind === "new-track" || cell.index !== item.index) {
      dispatch(trackEdit(item, cell.index));
    }
  }

  function removePiece(item: OnBoard | null) {
    if (item?.kind === "board-car") dispatch({ type: "removeCar", car: item.ref });
    else if (item) dispatch({ type: "removeTrack", at: item.index });
  }

  function tapBoard(cell: Cell, item: OnBoard | null = onBoard(cell)) {
    if (item?.kind === "board-car") {
      const { type } = item.car;
      if (isEngine(type)) post({ type: "call", sound: type });
      else if (type === "crane") renderer.swingCrane(item.ref, clock());
    } else if (item) {
      dispatch({ type: "turn", at: cell.index });
    }
  }

  /** What the page shows while the item is held. */
  function heldPiece(item: Grabbed): HeldPiece {
    switch (item.kind) {
      case "new-track":
        return { kind: "track", tile: { type: item.type, turn: 0, branch: false } };
      case "board-track":
        return { kind: "track", tile: item.tile };
      case "new-car":
      case "board-car":
        return { kind: "cars", type: item.car.type, color: item.car.color };
    }
  }

  function scene(): Scene {
    const item = held?.item;
    const trackDrop = hover && isTrack(item) ? item : null;
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
    if (valid && item?.kind === "new-car") {
      const placed = placeCar(board, index, hover.x - column, hover.y - row)!;
      [car] = carPositionsOn(placed.history, placed.progress, [item.car], board.cols);
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

  function grab(from: Requests["grab"]["message"]["from"]): HeldPiece | null {
    if (held) return null;
    let item: Grabbed | null;
    if (!("kind" in from)) {
      const cell = cellAt(from);
      item = cell && onBoard(cell);
    } else if (from.kind === "track") {
      item = { kind: "new-track", type: from.type };
    } else {
      item = { kind: "new-car", car: { type: from.type, color: from.color } };
    }
    if (!item) return null;
    held = { item, moved: false };
    return heldPiece(item);
  }

  function answer(request: Request) {
    switch (request.type) {
      case "edit": {
        const result = dispatch(toEdit(request.edit));
        return reply<"edit">(request.id, result.ok ? { ok: true } : result);
      }
      case "grab":
        return reply<"grab">(request.id, grab(request.from));
      case "picture":
        // A picture that fails, synchronously or not, is reported like any other failure.
        return void Promise.resolve(request.spec)
          .then((spec) => renderer.picture(spec))
          .then(
            (blob) => reply<"picture">(request.id, blob),
            (error: unknown) => fail(request.id, error),
          );
      case "yard":
        return reply<"yard">(request.id, toSaved(store.yard));
      case "builtIns":
        return reply<"builtIns">(request.id, [sampleLayout(), ...scenicPresets()].map(toSaved));
    }
  }

  function fail(id: number, error: unknown) {
    post({ type: "failed", id, error: error instanceof Error ? error.message : String(error) });
  }

  function release(at: BoardFraction | null, remove: boolean) {
    if (!held) return;
    const { item, moved } = held;
    held = null;
    hover = null;
    const target = cellAt(at);
    if (item.kind === "board-track" || item.kind === "board-car") {
      if (moved && remove) removePiece(item);
      else if (moved && target && item.kind === "board-track") dropPiece(target, item);
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
          hover = item.kind === "board-car" ? null : cellAt(message.at);
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
          if (hover && message.action === "remove") removePiece(onBoard(hover));
          else if (hover && message.action === "tap") tapBoard(hover);
          return renderer.sceneChanged();
        }
        default:
          try {
            return answer(message);
          } catch (error) {
            return fail(message.id, error);
          }
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
