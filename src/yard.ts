import {
  COLS,
  ROWS,
  GRID_SIZES,
  BACKGROUNDS,
  TRACK,
  STOCK,
  COLORS,
  TRACK_PALETTE,
  STOCK_PALETTE,
  indexAt,
  cellAt,
  isEngine,
} from "./railway.ts";
import type {
  Background,
  Board,
  Car,
  ColorName,
  GridSize,
  Point,
  StockType,
  Tile,
  TrackType,
} from "./railway.ts";
import { applyEdit } from "./model/edits.ts";
import type { Edit, EditResult, Refusal } from "./model/edits.ts";
import { initialMotion } from "./model/motion.ts";
import { carAt, carPositions, underTunnelRoof, visibleTile } from "./model/queries.ts";
import { MAX_CARS, carPositionsOn, placeCar } from "./model/train.ts";
import type { BoardPoint, TrainId, Yard } from "./model/types.ts";
import { createStore } from "./store.ts";
import { blankYard, sampleLayout, scenicPresets } from "./presets.ts";
import {
  DEFAULT_LIBRARY,
  YardLibrary,
  activeLibrary,
  addLibrary,
  readLibraries,
  removeLibrary,
  setActiveLibrary,
  yardNameKey,
} from "./libraries.ts";
import type { LibrarySettings, NewLibrary, SettingsStore } from "./libraries.ts";
import {
  drawGround,
  drawTile,
  drawCar,
  drawTunnelRoof,
  steamPuff,
  drawSteamPuff,
} from "./drawing.ts";
import type { SteamPuff } from "./drawing.ts";
import { TrainSound } from "./sound.ts";

type PaletteKind = "track" | "cars";

/** A grid square under the pointer or keyboard focus, with the exact point inside it. */
interface Cell {
  x: number;
  y: number;
  column: number;
  row: number;
  index: number;
}

interface TrackPiece {
  kind: "track";
  type: TrackType;
  color: ColorName;
  index?: undefined;
  tile?: undefined;
  train?: undefined;
}
interface CarPiece {
  kind: "cars";
  type: StockType;
  color: ColorName;
  index?: undefined;
  tile?: undefined;
  train?: undefined;
}
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
type Item = TrackPiece | CarPiece | BoardItem;
type TrackMove = TrackPiece | BoardTile;
type Drag = Item & {
  id: number;
  x: number;
  y: number;
  ghost: HTMLDivElement | null;
  moved: boolean;
};
type Puff = SteamPuff & { start: number; drift: number };

const symbols = {
  layout: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/>',
  track: '<path d="M8 3v18M16 3v18M5 6h14M5 12h14M5 18h14"/>',
  cars: '<rect x="4" y="5" width="16" height="13" rx="3"/><path d="M4 11h16M8 18l-2 3m10-3 2 3M8 15h1m6 0h1"/>',
  pause: '<path d="M9 5v14m6-14v14" stroke-width="3"/>',
  remove: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
  undo: '<path d="m8 5-5 5 5 5m-5-5h11a5 5 0 0 1 0 10h-3"/>',
  touch:
    '<path d="M9 12V5a2 2 0 0 1 4 0v5l4 .8a3 3 0 0 1 2.5 3.2l-.5 4a3 3 0 0 1-3 3H11a3 3 0 0 1-2.4-1.2L5 15.2a2 2 0 0 1 3-2.5L9 14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sound: '<path d="M11 4 6 8H3v8h3l5 4V4Zm4 5a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/>',
  mute: '<path d="M11 4 6 8H3v8h3l5 4V4Zm5 5 5 6m0-6-5 6"/>',
};
type Symbol = keyof typeof symbols;
function icon(name: Symbol) {
  return (
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    symbols[name] +
    "</svg>"
  );
}

// The page markup in index.html provides every element the app looks up.
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const children = <T extends HTMLElement = HTMLElement>(parent: Element) =>
  Array.from(parent.children) as T[];
const palette = $("palette");
const removeZone = $("remove");
const frame = $("map-frame");
const map = $("map");

/*
 * All drawing goes through OffscreenCanvas. The page holds a single canvas, the yard, whose
 * bitmap is driven by `screen`. Two offscreen layers cache what changes rarely, so an animation
 * frame is one bitmap copy plus the trains, steam and tunnel roofs drawn over it:
 *   groundLayer: the scenery, which is costly to paint; redrawn on resize or a new background.
 *   sceneLayer:  the ground plus track and the drag preview; redrawn when either changes.
 * Palette pieces, background samples and yard thumbnails are painted one at a time on the
 * shared `sketch` canvas and shown as images.
 */
const yardCanvas = $<HTMLCanvasElement>("yard-canvas");
const screen = yardCanvas.transferControlToOffscreen();
const groundLayer = new OffscreenCanvas(1, 1);
const sceneLayer = new OffscreenCanvas(1, 1);
const sketch = new OffscreenCanvas(1, 1);
// The ground paints every pixel, so the board layers can skip alpha blending with the page.
const opaque = { alpha: false };
const screenContext = screen.getContext("2d", opaque)!;
const groundContext = groundLayer.getContext("2d", opaque)!;
const sceneContext = sceneLayer.getContext("2d", opaque)!;
const sketchContext = sketch.getContext("2d")!;
type Context = OffscreenCanvasRenderingContext2D;
let groundStale = true;
let sceneStale = true;
let frameStale = true;
/** The board the scene layer last drew, which may be a drag preview; tunnel roofs follow it. */
let sceneBoard: Board;
const dialog = $<HTMLDialogElement>("layout-dialog");
const library = $<HTMLDialogElement>("layout-library");
const saveName = $<HTMLInputElement>("save-name");
const savedLayouts = $("saved-layouts");
const libraryNote = $("library-note");
const soundKey = "rail-yard-muted";
const sound = new TrainSound();
try {
  sound.enabled = localStorage.getItem(soundKey) !== "yes";
} catch {}
const soundButton = $("sound");
const store = createStore(sampleLayout());
let { cols, rows } = store.yard.board;
let paletteKind: PaletteKind = "track";
let color: ColorName = "brick";
let speed = 1;
let hover: Cell | null = null;
let keyboardCell: Point = [0, 0];
let drag: Drag | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let lastFrame: number | undefined;
let smokePuffs: Puff[] = [];
/** When each steam engine last puffed, keyed by train and car index. */
let lastPuff = new Map<string, number>();
const puffLifetime = 760;
let movingTrains: ReadonlySet<TrainId> = new Set();
let activeCrane: { trainId: TrainId; carIndex: number; start: number } | null = null;
const carKey = (trainId: TrainId, carIndex: number) => trainId + ":" + carIndex;
const craneSwingDuration = 950;

let libraryEntries: Yard[] = [];
let libraryPage = 0;
const yardsPerPage = 5;

/** Library settings live in local storage; with it blocked, only the default library is offered. */
const settingsStore: SettingsStore = (() => {
  try {
    localStorage.getItem(soundKey);
    return localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
  }
})();
let yardLibrary = new YardLibrary(activeLibrary(settingsStore));

/** The built-in yards and those in the current library, which replace built-ins with the same name. */
async function listYards() {
  const yards = new Map<string, Yard>();
  for (const yard of [sampleLayout(), ...scenicPresets(), ...(await yardLibrary.list())]) {
    yards.set(yardNameKey(yard.name), yard);
  }
  return [...yards.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Paints a picture on the shared sketch canvas and resolves to an image URL for it. */
function sketchImage(width: number, height: number, draw: (ctx: Context) => void) {
  sketch.width = width;
  sketch.height = height;
  sketchContext.resetTransform();
  sketchContext.clearRect(0, 0, width, height);
  draw(sketchContext);
  // convertToBlob copies the bitmap right away, so the sketch is free for the next picture.
  return sketch.convertToBlob().then((blob) => URL.createObjectURL(blob));
}

/** The URL each image is waiting for, so a slow, outdated picture never replaces a newer one. */
const awaitedImages = new WeakMap<HTMLImageElement, Promise<string>>();
function showImage(image: HTMLImageElement, url: Promise<string>) {
  awaitedImages.set(image, url);
  void url.then((src) => {
    if (awaitedImages.get(image) === url) image.src = src;
  });
}
/** A decorative image that shows the picture once it is ready. */
function picture(url: Promise<string>) {
  const image = document.createElement("img");
  image.alt = "";
  image.draggable = false;
  showImage(image, url);
  return image;
}

function drawYardThumbnail(ctx: Context, yard: Yard, width: number, height: number) {
  const { board } = yard;
  const scale = Math.min(width / board.cols, height / board.rows);
  ctx.translate((width - board.cols * scale) / 2, (height - board.rows * scale) / 2);
  ctx.scale(scale, scale);
  drawGround(ctx, yard.background, board.cols, board.rows);
  drawTiles(ctx, board);
  for (const cars of carPositions(yard, initialMotion(yard)).values()) {
    for (const car of cars) drawCar(ctx, car, car.x, car.y, car.angle);
  }
  drawTunnelRoofs(ctx, board);
}

/** Thumbnails shown in the library; they are released when the page of yards changes. */
let thumbnails: HTMLImageElement[] = [];

function releaseThumbnails() {
  for (const image of thumbnails) {
    const url = awaitedImages.get(image);
    // Forget the picture first, so a thumbnail still being painted never loads a released URL.
    awaitedImages.delete(image);
    void url?.then((src) => URL.revokeObjectURL(src));
  }
  thumbnails = [];
}

function drawTiles(ctx: Context, board: Board, skip = -1) {
  for (const [index, tile] of board.grid.entries()) {
    if (tile && index !== skip)
      drawTile(ctx, visibleTile({ board }, index)!, ...cellAt(index, board.cols), board);
  }
}

function showLibrary() {
  const start = libraryPage * yardsPerPage;
  const pages = Math.max(1, Math.ceil(libraryEntries.length / yardsPerPage));
  const fresh = blankYard(store.yard.board, store.yard.background);
  const entries = [fresh, ...libraryEntries.slice(start, start + yardsPerPage)];
  savedLayouts.replaceChildren();
  releaseThumbnails();
  entries.forEach((yard, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "saved-yard";
    const thumbnail = picture(
      sketchImage(288, 168, (ctx) => drawYardThumbnail(ctx, yard, 288, 168)),
    );
    thumbnails.push(thumbnail);
    const caption = document.createElement("span");
    caption.textContent = index === 0 ? "New yard" : yard.name;
    button.append(thumbnail, caption);
    button.onclick = () => {
      store.dispatch({ type: "replace", yard });
      if (index === 0) {
        if (!speed) setSpeed(1);
        setPalette("track");
      }
      library.close();
      if (index !== 0) notify("Loaded " + yard.name + ".");
    };
    savedLayouts.append(button);
  });
  $("library-pages").hidden = pages === 1;
  $("library-page").textContent = libraryPage + 1 + " / " + pages;
  $<HTMLButtonElement>("library-prev").disabled = libraryPage === 0;
  $<HTMLButtonElement>("library-next").disabled = libraryPage + 1 >= pages;
  updateSaveLabel(libraryEntries);
}

$("library-prev").onclick = () => {
  libraryPage -= 1;
  showLibrary();
};
$("library-next").onclick = () => {
  libraryPage += 1;
  showLibrary();
};

function updateSaveLabel(entries: Yard[]) {
  const name = yardNameKey(saveName.value.trim());
  const exists = entries.some((entry) => yardNameKey(entry.name) === name);
  $("save-yard").textContent = exists ? "Update yard" : "Save yard";
}

const refusalMessages: Record<Refusal, string> = {
  "square-occupied": "Wait for the train to clear this square.",
  "needs-track": "Drop the car on a track piece.",
  "needs-engine": "Add an engine to this track first.",
  "engine-blocked": "Drop it onto the train to couple it, or try a clear square.",
  "train-full": "A train can hold up to " + MAX_CARS + " cars.",
  "loop-too-short": "This loop is too short for another car.",
  "needs-more-track": "Add more track before coupling another car.",
  "too-big-for-size": "This yard is too wide or tall for that size.",
  "no-change": "",
};

function refuse(reason: Refusal) {
  if (refusalMessages[reason]) notify(refusalMessages[reason]);
}

function notify(message: string) {
  const toast = $("toast");
  toast.hidden = false;
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2300);
}

function updateStatus() {
  const { yard } = store;
  ({ cols, rows } = yard.board);
  for (const button of children($("grid-sizes"))) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.cols) === cols));
  }
  const title = $("layout-name");
  title.textContent = yard.name;
  title.title = yard.name;
  $<HTMLButtonElement>("undo").disabled = !store.canUndo;
  updateBackgroundButtons();
}

const buttons: [id: string, symbol: Symbol, text: string][] = [
  ["track-tab", "track", "Track"],
  ["cars-tab", "cars", "Train cars"],
  ["remove", "remove", "Drag Here to Remove"],
];
for (const [id, symbol, text] of buttons) $(id).innerHTML = icon(symbol) + text;
$("undo").innerHTML = icon("undo") + "<span>Undo</span>";
$("layouts").innerHTML = icon("layout") + "<span>Layouts</span>";
$("layouts").setAttribute("aria-label", "Layouts");
dialog.querySelector(".close")!.innerHTML = icon("close");
const closeLibrary = library.querySelector<HTMLButtonElement>(".close")!;
closeLibrary.innerHTML = icon("close");
closeLibrary.onclick = () => library.close();

function background() {
  return store.yard.background;
}

function updateBackgroundButtons() {
  for (const button of children($("backgrounds"))) {
    button.setAttribute("aria-pressed", String(button.dataset.background === background()));
  }
}

for (const [key, name] of Object.entries(BACKGROUNDS) as [Background, string][]) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "background-option";
  button.dataset.background = key;
  const sample = sketchImage(216, 126, (ctx) => {
    ctx.scale(216 / COLS, 126 / ROWS);
    drawGround(ctx, key, COLS, ROWS);
  });
  button.append(picture(sample), name);
  button.onclick = () => {
    store.dispatch({ type: "setBackground", background: key });
    dialog.close("background");
  };
  $("backgrounds").append(button);
}
const gridNote = $("grid-note");
const blankAtSize = $("blank-at-size");
let pendingSize: GridSize | null = null;

function resetGridNotice() {
  pendingSize = null;
  gridNote.hidden = true;
  blankAtSize.hidden = true;
}

function startBlank(size: GridSize) {
  store.dispatch({ type: "replace", yard: blankYard(size, background()) });
  dialog.close("grid-size");
}

for (const size of GRID_SIZES) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "layout-option grid-option";
  button.dataset.cols = String(size.cols);
  const dimensions = document.createElement("span");
  dimensions.textContent = size.cols + " × " + size.rows;
  button.append(size.label, dimensions);
  button.onclick = () => {
    resetGridNotice();
    if (size.cols === cols) return;
    const result = store.dispatch({ type: "resize", size });
    if (result.ok) return dialog.close("grid-size");
    if (result.reason !== "too-big-for-size") return;
    pendingSize = size;
    gridNote.textContent = "This yard is too wide or tall for " + dimensions.textContent + ".";
    gridNote.hidden = false;
    blankAtSize.textContent = "Start blank at " + dimensions.textContent;
    blankAtSize.hidden = false;
  };
  $("grid-sizes").append(button);
}

blankAtSize.onclick = () => {
  if (pendingSize) startBlank(pendingSize);
};

$("start-blank").onclick = () => {
  startBlank(store.yard.board);
  setPalette("track");
};

function updateCoordinates() {
  if ($("columns").children.length === cols && $("rows").children.length === rows) return;
  map.style.setProperty("--cols", String(cols));
  map.style.setProperty("--rows", String(rows));
  const columns = Array.from({ length: cols }, (_, index) => {
    const label = document.createElement("span");
    label.textContent = String.fromCharCode(65 + index);
    return label;
  });
  const rowLabels = Array.from({ length: rows }, (_, index) => {
    const label = document.createElement("span");
    label.textContent = String(index + 1);
    return label;
  });
  $("columns").replaceChildren(...columns);
  $("rows").replaceChildren(...rowLabels);
}

/** Piece pictures by kind, type, turn and color; there are few, so they are kept for reuse. */
const previews = new Map<string, Promise<string>>();

function preview(
  type: TrackType | StockType,
  kind: PaletteKind,
  paint: ColorName = color,
  tile: Tile = { type: type as TrackType, turn: 0, branch: false },
) {
  const key =
    kind === "track"
      ? [kind, tile.type, tile.turn, tile.branch].join()
      : [kind, type, paint].join();
  let url = previews.get(key);
  if (url) return url;
  const width = kind === "track" ? 144 : 176;
  const height = kind === "track" ? 128 : 120;
  url = sketchImage(width, height, (ctx) => {
    ctx.translate(width / 2, height / 2);
    if (kind === "track") {
      ctx.scale(120, 120);
      drawTile(ctx, tile, -0.5, -0.5);
      if (tile.type === "tunnel") drawTunnelRoof(ctx, tile, -0.5, -0.5);
    } else {
      ctx.scale(220, 220);
      drawCar(ctx, { type: type as StockType, color: paint }, 0, 0);
    }
  });
  previews.set(key, url);
  return url;
}

/** The picture of a dragged piece. */
function dragPreview(item: Item & { type: TrackType | StockType }) {
  const kind = item.kind === "board" ? (item.train !== undefined ? "cars" : "track") : item.kind;
  return preview(item.type, kind, item.color, item.tile);
}

function fillPalette() {
  const items: (TrackPiece | CarPiece)[] =
    paletteKind === "track"
      ? TRACK_PALETTE.map((type) => ({ kind: "track", type, color }))
      : STOCK_PALETTE.map((type) => ({ kind: "cars", type, color }));
  palette.dataset.kind = paletteKind;
  palette.replaceChildren();
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "piece";
    card.dataset.piece = item.type;
    const label = document.createElement("span");
    label.textContent = item.kind === "track" ? TRACK[item.type].name : STOCK[item.type].name;
    card.append(picture(preview(item.type, item.kind)), label);
    card.addEventListener("pointerdown", (event) => beginDrag(event, item));
    palette.append(card);
  }
  updatePalette();
}

function updatePalette(refreshArt = false) {
  const tracks = paletteKind === "track";
  $("track-tab").setAttribute("aria-pressed", String(tracks));
  $("cars-tab").setAttribute("aria-pressed", String(!tracks));
  palette.setAttribute("aria-label", tracks ? "Track pieces" : "Train cars");
  $("colors").hidden = tracks;
  $("color-name").textContent = COLORS[color][0];
  if (refreshArt) {
    for (const card of children(palette)) {
      const piece = card.dataset.piece as TrackType | StockType;
      showImage(card.firstElementChild as HTMLImageElement, preview(piece, paletteKind));
    }
  }
  for (const swatch of children($("swatches")))
    swatch.setAttribute("aria-pressed", String(swatch.dataset.color === color));
  const hint = tracks
    ? "Drag tracks to place or move them. Tap to turn."
    : "Drag cars onto the rails. Drop an engine on a train to join it.";
  $("tool-hint").innerHTML = icon("touch") + hint;
  refreshScene();
}

for (const [key, [name, fill]] of Object.entries(COLORS) as [ColorName, [string, string]][]) {
  const swatch = document.createElement("button");
  swatch.className = "swatch";
  swatch.dataset.color = key;
  swatch.setAttribute("aria-label", name);
  swatch.title = name;
  swatch.style.setProperty("--swatch", fill);
  swatch.append(document.createElement("span"));
  swatch.addEventListener("click", () => {
    color = key;
    updatePalette(true);
  });
  $("swatches").append(swatch);
}

function setPalette(next: PaletteKind) {
  if (next === paletteKind || drag) return;
  paletteKind = next;
  fillPalette();
}

function resize() {
  updateCoordinates();
  const area = getComputedStyle(frame);
  const track = getComputedStyle(map);
  const width = frame.clientWidth - parseFloat(area.paddingLeft) - parseFloat(area.paddingRight);
  const height = frame.clientHeight - parseFloat(area.paddingTop) - parseFloat(area.paddingBottom);
  const marginX = parseFloat(track.gridTemplateColumns);
  const marginY = parseFloat(track.gridTemplateRows);
  const cell = Math.max(1, Math.min((width - marginX) / cols, (height - marginY) / rows));
  map.style.width = cell * cols + marginX + "px";
  map.style.height = cell * rows + marginY + "px";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const canvas of [screen, groundLayer, sceneLayer]) {
    canvas.width = Math.max(1, Math.round(cell * cols * dpr));
    canvas.height = Math.max(1, Math.round(cell * rows * dpr));
  }
  refreshGround();
  // Resizing cleared the screen, and a resize observer runs after this frame's tick: draw now.
  render();
}

/** Scales a context so one unit is one grid square. */
function toBoardUnits(ctx: Context) {
  ctx.setTransform(ctx.canvas.width / cols, 0, 0, ctx.canvas.height / rows, 0, 0);
}

/** Copies a whole layer onto another of the same size, pixel for pixel. */
function copyLayer(ctx: Context, layer: OffscreenCanvas) {
  ctx.resetTransform();
  ctx.drawImage(layer, 0, 0);
}

/** Marks layers for redrawing on the next frame, which redraws each at most once. */
function refreshGround() {
  groundStale = sceneStale = frameStale = true;
}
function refreshScene() {
  sceneStale = frameStale = true;
}
function refreshFrame() {
  frameStale = true;
}

/** Draws the stale layers and composes the frame onto the screen. */
function render(now = performance.now(), emitSmoke = false) {
  if (groundStale) {
    toBoardUnits(groundContext);
    drawGround(groundContext, background(), cols, rows);
    groundStale = false;
  }
  if (sceneStale) {
    drawScene();
    sceneStale = false;
  }
  copyLayer(screenContext, sceneLayer);
  toBoardUnits(screenContext);
  drawStock(screenContext, now, emitSmoke);
  drawTunnelRoofs(screenContext, sceneBoard);
  frameStale = false;
}

function movesTrack(item: Item | null): item is TrackMove {
  return item?.kind === "track" || Boolean(item?.tile);
}

function trackEdit(item: TrackMove, index: number): Edit {
  return item.tile
    ? { type: "moveTrack", from: item.index, to: index }
    : { type: "placeTrack", at: index, track: item.type };
}

const boardPoint = (cell: Cell): BoardPoint => ({
  index: cell.index,
  x: cell.x - cell.column,
  y: cell.y - cell.row,
});

/** Draws the ground, the track and any drag preview onto the scene layer. */
function drawScene() {
  const ctx = sceneContext;
  copyLayer(ctx, groundLayer);
  toBoardUnits(ctx);
  const trackDrop = hover && movesTrack(drag) ? drag : null;
  // A drag previews the edit without committing it.
  const preview: EditResult | null =
    trackDrop && hover
      ? applyEdit(store.yard, store.motion, trackEdit(trackDrop, hover.index))
      : null;
  const board = preview?.ok ? preview.yard.board : store.yard.board;
  sceneBoard = board;
  drawTiles(ctx, board, hover?.index);
  if (!hover) return;
  const { column, row, index } = hover;
  const tile = board.grid[index];
  const valid = trackDrop
    ? Boolean(preview?.ok) || (preview?.ok === false && preview.reason === "no-change")
    : Boolean(tile);
  ctx.fillStyle = valid ? "#fff2b883" : "#c7705959";
  ctx.fillRect(column, row, 1, 1);
  ctx.strokeStyle = valid ? "#935e2d" : "#9b4538";
  ctx.lineWidth = 0.05;
  ctx.strokeRect(column + 0.025, row + 0.025, 0.95, 0.95);
  if (tile) drawTile(ctx, visibleTile({ board }, index)!, column, row, board);
  if (valid && drag?.kind === "cars") {
    const placed = placeCar(board, index, hover.x - column, hover.y - row)!;
    const car: Car = { type: drag.type, color: drag.color };
    const [position] = carPositionsOn(placed.history, placed.progress, [car], cols);
    ctx.globalAlpha = 0.73;
    drawCar(ctx, position, position.x, position.y, position.angle);
    ctx.globalAlpha = 1;
  }
}

function drawTunnelRoofs(ctx: Context, board: Board) {
  for (const [index, tile] of board.grid.entries()) {
    if (tile?.type === "tunnel") drawTunnelRoof(ctx, tile, ...cellAt(index, board.cols), board);
  }
}

/** Clears steam and crane swings; only a newly loaded or blank yard does this. */
function resetTrainEffects() {
  smokePuffs = [];
  lastPuff = new Map();
  activeCrane = null;
}

/** Draws the trains and their steam, puffing more steam when `emitSmoke` is set. */
function drawStock(ctx: Context, now: number, emitSmoke: boolean) {
  const { yard } = store;
  const positions = carPositions(yard, store.motion);
  for (const train of yard.trains) {
    for (const [carIndex, car] of (positions.get(train.id) ?? []).entries()) {
      const key = carKey(train.id, carIndex);
      const swing =
        activeCrane && carKey(activeCrane.trainId, activeCrane.carIndex) === key
          ? (now - activeCrane.start) / craneSwingDuration
          : 0;
      const angle = Math.sin(Math.PI * Math.max(0, Math.min(1, swing))) * 1.65;
      drawCar(ctx, car, car.x, car.y, car.angle, angle);
      if (
        emitSmoke &&
        car.type === "steam" &&
        movingTrains.has(train.id) &&
        now - (lastPuff.get(key) ?? -Infinity) >= 260 / Math.sqrt(speed)
      ) {
        const puff = steamPuff(car);
        if (!underTunnelRoof(yard.board, puff.x, puff.y)) {
          lastPuff.set(key, now);
          smokePuffs.push({ ...puff, start: now, drift: (Math.random() - 0.35) * 0.13 });
        }
      }
    }
  }
  smokePuffs = smokePuffs.filter((puff) => now - puff.start < puffLifetime);
  for (const puff of smokePuffs)
    drawSteamPuff(ctx, puff, Math.max(0, now - puff.start) / puffLifetime);
}

function tick(now: number) {
  const seconds = lastFrame === undefined ? 0 : Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  // Trains stay paused while something is being dragged.
  const moving = speed && store.yard.trains.length && !drag?.moved;
  if (moving) {
    const events = store.tick(seconds, speed);
    movingTrains = events.movingTrains;
    sound.update(events.movingEngines, speed);
    for (let i = 0; i < events.stationArrivals; i += 1) sound.call("station");
  } else {
    movingTrains = new Set();
    sound.stopRolling();
  }
  if (moving || activeCrane || smokePuffs.length || frameStale) render(now, Boolean(moving));
  if (activeCrane && now - activeCrane.start >= craneSwingDuration) activeCrane = null;
  requestAnimationFrame(tick);
}

function locate(event: PointerEvent): Cell | null {
  const rect = yardCanvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * cols;
  const y = ((event.clientY - rect.top) / rect.height) * rows;
  const column = Math.floor(x);
  const row = Math.floor(y);
  if (column < 0 || column >= cols || row < 0 || row >= rows) return null;
  return { x, y, column, row, index: indexAt(column, row, cols) };
}

function hitCar(cell: Cell, bySquare = false) {
  return carAt(store.yard, store.motion, boardPoint(cell), bySquare);
}

function dispatch(edit: Edit) {
  const result = store.dispatch(edit);
  if (!result.ok) refuse(result.reason);
}

function dropPiece(cell: Cell, item: TrackMove | CarPiece) {
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

function boardItem(cell: Cell): BoardItem {
  const hit = hitCar(cell, true);
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

function tapBoard(cell: Cell, item: BoardItem = boardItem(cell)) {
  if (item.train !== undefined && isEngine(item.type)) sound.call(item.type);
  else if (item.train !== undefined && item.type === "crane") {
    activeCrane = { trainId: item.train, carIndex: item.carIndex, start: performance.now() };
  } else if (store.yard.board.grid[cell.index]) dispatch({ type: "turn", at: cell.index });
}

function beginDrag(event: PointerEvent, item: Item) {
  if (!event.isPrimary || event.button !== 0 || drag) return;
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
  drag = {
    ...item,
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    ghost: null,
    moved: false,
  };
  // Start painting the drag picture now, so it is ready once the pointer moves.
  if (item.type) void dragPreview(item);
}

function overRemove(event: PointerEvent) {
  const box = removeZone.getBoundingClientRect();
  return (
    event.clientX >= box.left &&
    event.clientX <= box.right &&
    event.clientY >= box.top &&
    event.clientY <= box.bottom
  );
}

function moveDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 7) return;
  drag.moved = true;
  if (!drag.type) return;
  let ghost = drag.ghost;
  if (!ghost) {
    ghost = drag.ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.append(picture(dragPreview(drag)));
    document.body.append(ghost);
    removeZone.classList.toggle("available", drag.kind === "board");
  }
  hover = drag.kind === "board" && !drag.tile ? null : locate(event);
  removeZone.classList.toggle("targeted", drag.kind === "board" && overRemove(event));
  ghost.hidden = Boolean(hover);
  ghost.style.transform =
    "translate(" + (event.clientX - 36) + "px," + (event.clientY - 36) + "px)";
  refreshScene();
}

function endDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return;
  const item = drag;
  item.ghost?.remove();
  drag = null;
  hover = null;
  removeZone.classList.toggle("available", false);
  removeZone.classList.toggle("targeted", false);
  if (event.type === "pointerup") {
    const target = locate(event);
    if (item.kind === "board") {
      if (item.moved && overRemove(event)) removePiece(item);
      else if (item.moved && target && item.tile) dropPiece(target, item);
      else if (!item.moved && target?.index === item.index) tapBoard(target, item);
    } else if (target && item.moved) {
      dropPiece(target, item);
    }
  }
  refreshScene();
}

for (const surface of [palette, yardCanvas]) {
  surface.addEventListener("pointermove", moveDrag);
  surface.addEventListener("pointerup", endDrag);
  surface.addEventListener("pointercancel", endDrag);
  surface.addEventListener("lostpointercapture", endDrag);
}
yardCanvas.addEventListener("pointerdown", (event) => {
  const cell = locate(event);
  if (!cell) return;
  keyboardCell = [cell.column, cell.row];
  beginDrag(event, boardItem(cell));
});
yardCanvas.addEventListener("keydown", (event) => {
  const movement: Partial<Record<string, Point>> = {
    ArrowUp: [0, -1],
    ArrowRight: [1, 0],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
  };
  const step = movement[event.key];
  if (!step && !["Enter", " ", "Delete", "Backspace"].includes(event.key)) return;
  event.preventDefault();
  if (step) {
    keyboardCell = [
      Math.max(0, Math.min(cols - 1, keyboardCell[0] + step[0])),
      Math.max(0, Math.min(rows - 1, keyboardCell[1] + step[1])),
    ];
  }
  const [column, row] = keyboardCell;
  hover = { column, row, x: column + 0.5, y: row + 0.5, index: indexAt(column, row, cols) };
  if (event.key === "Delete" || event.key === "Backspace") removePiece(boardItem(hover));
  else if (!step) tapBoard(hover);
  refreshScene();
});
yardCanvas.addEventListener("blur", () => {
  hover = null;
  refreshScene();
});

$("track-tab").onclick = () => setPalette("track");
$("cars-tab").onclick = () => setPalette("cars");
$("undo").onclick = () => store.undo();
$("layouts").onclick = () => {
  resetGridNotice();
  dialog.returnValue = "cancel";
  dialog.showModal();
};
const librarySelect = $<HTMLSelectElement>("library-select");
const removeLibraryButton = $<HTMLButtonElement>("remove-library");
const s3Form = $<HTMLFormElement>("s3-library");
/** Counts library loads, so a slow one that finishes after a newer one is ignored. */
let libraryLoad = 0;

function fillLibrarySelect() {
  const libraries = readLibraries(settingsStore);
  librarySelect.replaceChildren(
    ...libraries.map((settings) => {
      const option = document.createElement("option");
      option.value = settings.id;
      option.textContent = settings.kind === "s3" ? settings.name + " (S3)" : settings.name;
      return option;
    }),
  );
  librarySelect.value = yardLibrary.settings.id;
  removeLibraryButton.hidden = yardLibrary.settings.id === DEFAULT_LIBRARY.id;
}

function useLibrary(settings: LibrarySettings) {
  setActiveLibrary(settingsStore, settings.id);
  yardLibrary = new YardLibrary(settings);
  fillLibrarySelect();
  return reloadLibrary();
}

/** Shows the built-in yards right away, then adds the library's yards once they arrive. */
async function reloadLibrary() {
  const load = (libraryLoad += 1);
  const current = yardLibrary;
  libraryEntries = [sampleLayout(), ...scenicPresets()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  libraryPage = 0;
  libraryNote.textContent = "Loading " + current.settings.name + "…";
  showLibrary();
  try {
    const entries = await listYards();
    if (load !== libraryLoad) return;
    libraryEntries = entries;
    libraryNote.textContent = "";
  } catch {
    if (load !== libraryLoad) return;
    libraryNote.textContent =
      "Could not open " + current.settings.name + ". Showing built-in yards.";
  }
  showLibrary();
}

librarySelect.onchange = () => {
  const settings = readLibraries(settingsStore).find(({ id }) => id === librarySelect.value);
  if (settings) void useLibrary(settings);
};
removeLibraryButton.onclick = () => {
  const { id, name } = yardLibrary.settings;
  if (id === DEFAULT_LIBRARY.id) return;
  if (!confirm("Remove " + name + "? Yards saved in it stay in the bucket.")) return;
  removeLibrary(settingsStore, id);
  void useLibrary(DEFAULT_LIBRARY);
};
s3Form.onsubmit = async (event) => {
  event.preventDefault();
  const field = (name: string) =>
    (s3Form.elements.namedItem(name) as HTMLInputElement).value.trim();
  const region = field("region");
  const keyPrefix = field("keyPrefix");
  const settings: NewLibrary = {
    kind: "s3",
    name: field("name"),
    bucketUrl: field("bucketUrl"),
    accessKeyId: field("accessKeyId"),
    secretAccessKey: field("secretAccessKey"),
    ...(region && { region }),
    ...(keyPrefix && { keyPrefix }),
  };
  const submit = $<HTMLButtonElement>("add-s3");
  submit.disabled = true;
  libraryNote.textContent = "Connecting to " + settings.name + "…";
  try {
    // Check the bucket answers before keeping its settings.
    await new YardLibrary({ ...settings, id: "draft" }).list();
  } catch {
    libraryNote.textContent =
      "Could not reach that bucket. Check the URL, keys and the bucket's CORS settings.";
    return;
  } finally {
    submit.disabled = false;
  }
  const added = addLibrary(settingsStore, settings);
  s3Form.reset();
  $<HTMLDetailsElement>("add-library").open = false;
  await useLibrary(added);
};

$("open-library").onclick = () => {
  dialog.close("library");
  saveName.value = store.yard.name;
  fillLibrarySelect();
  void reloadLibrary();
  library.showModal();
};
saveName.oninput = () => updateSaveLabel(libraryEntries);
$("save-layout").onsubmit = async (event) => {
  event.preventDefault();
  const name = saveName.value.trim().slice(0, 48);
  if (!name) {
    libraryNote.textContent = "Enter a name for your yard.";
    return;
  }
  const saveButton = $<HTMLButtonElement>("save-yard");
  saveButton.disabled = true;
  try {
    await yardLibrary.save({ ...store.yard, name });
  } catch {
    libraryNote.textContent =
      "Could not save this yard to " + yardLibrary.settings.name + ". Try again.";
    return;
  } finally {
    saveButton.disabled = false;
  }
  store.dispatch({ type: "rename", name });
  library.close();
  notify("Saved " + name + " to " + yardLibrary.settings.name + ".");
};
const speedButtons = document.querySelectorAll<HTMLButtonElement>("[data-speed]");
document.querySelector('[data-speed="0"]')!.innerHTML = icon("pause");
function setSpeed(nextSpeed: number) {
  speed = nextSpeed;
  if (!speed) sound.stopRolling();
  for (const button of speedButtons)
    button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === speed));
}
for (const button of speedButtons) {
  button.onclick = () => setSpeed(Number(button.dataset.speed));
}
function updateSoundButton() {
  soundButton.innerHTML = icon(sound.enabled ? "sound" : "mute");
  soundButton.setAttribute("aria-pressed", String(sound.enabled));
}
soundButton.onclick = () => {
  sound.setEnabled(!sound.enabled);
  try {
    localStorage.setItem(soundKey, sound.enabled ? "no" : "yes");
  } catch {}
  updateSoundButton();
};
for (const activation of ["pointerup", "click", "keydown"]) {
  document.addEventListener(activation, () => sound.unlock(), { capture: true, passive: true });
}
document.addEventListener("visibilitychange", () => {
  sound.setHidden(document.hidden);
});
for (const gesture of ["gesturestart", "gesturechange", "gestureend", "wheel"]) {
  document.addEventListener(gesture, (event) => event.preventDefault(), { passive: false });
}

store.subscribe(({ yard, previous, edit }) => {
  if (edit?.type === "replace") resetTrainEffects();
  if (!edit || edit.type === "replace" || edit.type === "resize") {
    hover = null;
    keyboardCell = [0, 0];
  }
  updateStatus();
  if (yard.board.cols !== previous.board.cols || yard.board.rows !== previous.board.rows) {
    resize();
    return;
  }
  if (yard.background !== previous.background) refreshGround();
  if (yard.board !== previous.board) refreshScene();
  refreshFrame();
});

fillPalette();
updateSoundButton();
updateStatus();
resize();
new ResizeObserver(resize).observe(frame);
requestAnimationFrame(tick);
