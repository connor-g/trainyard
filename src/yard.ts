import {
  COLS,
  ROWS,
  GRID_SIZES,
  resizeLayout,
  BACKGROUNDS,
  TRACK,
  STOCK,
  COLORS,
  TRACK_PALETTE,
  STOCK_PALETTE,
  indexAt,
  cellAt,
  fitTrack,
  rotateTrack,
  isEngine,
  isSwitch,
  switchBranch,
  startTrain,
  nearestTrain,
  couple,
  advance,
  carPositions,
  blankLayout,
  underTunnelRoof,
} from "./railway.ts";
import type {
  Background,
  Board,
  Car,
  CarPosition,
  ColorName,
  GridSize,
  Layout,
  Point,
  StockType,
  Tile,
  TrackEdit,
  TrackType,
  Train,
} from "./railway.ts";
import { sampleLayout, scenicPresets } from "./presets.ts";
import { fromLegacy, toLegacy } from "./legacy.ts";
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
  train: Train;
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
type GridEdit = [index: number, tile: Tile | null];
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
const context2d = (canvas: HTMLCanvasElement) => canvas.getContext("2d")!;
const palette = $("palette");
const removeZone = $("remove");
const rails = $<HTMLCanvasElement>("rails");
const frame = $("map-frame");
const map = $("map");
const canvasLayers = [
  $<HTMLCanvasElement>("ground"),
  rails,
  $<HTMLCanvasElement>("rolling-stock"),
  $<HTMLCanvasElement>("tunnel-roofs"),
];
const [groundContext, railsContext, stockContext, roofContext] = canvasLayers.map(context2d);
const dialog = $<HTMLDialogElement>("layout-dialog");
const library = $<HTMLDialogElement>("layout-library");
const saveName = $<HTMLInputElement>("save-name");
const savedLayouts = $("saved-layouts");
const libraryNote = $("library-note");
const saveKey = "rail-yard-v1";
const libraryKey = "rail-yard-saved-layouts-v1";
const soundKey = "rail-yard-muted";
const sound = new TrainSound();
try {
  sound.enabled = localStorage.getItem(soundKey) !== "yes";
} catch {}
const soundButton = $("sound");
const undoStack: Layout[] = [];
let layout = load();
let { cols, rows } = layout.board;
let paletteKind: PaletteKind = "track";
let color: ColorName = "brick";
let speed = 1;
let hover: Cell | null = null;
let keyboardCell: Point = [0, 0];
let drag: Drag | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let stockFrame: CarPosition[][] = [];
let lastFrame: number | undefined;
let smokeLayout = layout;
let smokePuffs: Puff[] = [];
let lastPuff = new WeakMap<Car, number>();
const puffLifetime = 760;
const movingTrains = new Set<Train>();
const recordMovement = (train: Train) => movingTrains.add(train);
let activeCrane: { car: Car; start: number } | null = null;
const craneSwingDuration = 950;
const ringStation = () => sound.call("station");

function load(): Layout {
  try {
    const raw = localStorage.getItem(saveKey);
    const saved = raw ? fromLegacy(JSON.parse(raw)) : null;
    if (saved) return saved;
  } catch {
    // A blocked or unavailable storage area still allows play for this visit.
  }
  return sampleLayout();
}

let libraryEntries: Layout[] = [];
let libraryPage = 0;
const yardsPerPage = 5;

function readSavedYards(): Layout[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(libraryKey) ?? "[]");
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((entry) => typeof entry?.name === "string" && entry.name.trim())
      .flatMap((entry) => fromLegacy(entry) ?? []);
  } catch {
    return [];
  }
}

function listYards() {
  // Saved yards replace built-in yards with the same name.
  const yards = new Map<string, Layout>();
  for (const yard of [sampleLayout(), ...scenicPresets(), ...readSavedYards()]) {
    yards.set(layoutNameKey(yard.name), yard);
  }
  return [...yards.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function storeYard(yard: Layout) {
  const key = layoutNameKey(yard.name);
  const saved = readSavedYards().filter((entry) => layoutNameKey(entry.name) !== key);
  saved.push(yard);
  localStorage.setItem(libraryKey, JSON.stringify(saved.map(toLegacy)));
}

function layoutNameKey(name: string) {
  return name.toLowerCase();
}

function drawYardThumbnail(canvas: HTMLCanvasElement, yard: Layout) {
  const { board } = yard;
  const { cols: width, rows: height } = board;
  const scale = Math.min(canvas.width / width, canvas.height / height);
  const ctx = context2d(canvas);
  ctx.translate((canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2);
  ctx.scale(scale, scale);
  drawGround(ctx, yard.background, width, height);
  for (const [index, tile] of board.grid.entries()) {
    if (!tile) continue;
    const visible = isSwitch(tile) ? { ...tile, branch: switchBranch(board, index, tile) } : tile;
    drawTile(ctx, visible, ...cellAt(index, width), board);
  }
  for (const train of yard.trains) {
    for (const car of carPositions(train, width)) drawCar(ctx, car, car.x, car.y, car.angle);
  }
  drawTunnelRoofs(ctx, board);
}

function showLibrary() {
  const start = libraryPage * yardsPerPage;
  const pages = Math.max(1, Math.ceil(libraryEntries.length / yardsPerPage));
  const fresh = blankLayout(layout.board, layout.background);
  const entries = [fresh, ...libraryEntries.slice(start, start + yardsPerPage)];
  savedLayouts.replaceChildren();
  entries.forEach((yard, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "saved-yard";
    const thumbnail = document.createElement("canvas");
    thumbnail.width = 288;
    thumbnail.height = 168;
    thumbnail.setAttribute("aria-hidden", "true");
    drawYardThumbnail(thumbnail, yard);
    const caption = document.createElement("span");
    caption.textContent = index === 0 ? "New yard" : yard.name;
    button.append(thumbnail, caption);
    button.onclick = () => {
      const previous = snapshot();
      layout = structuredClone(yard);
      hover = null;
      keyboardCell = [0, 0];
      if (index === 0) {
        if (!speed) setSpeed(1);
        setPalette("track");
      }
      commit(previous);
      resize();
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

function updateSaveLabel(entries: Layout[]) {
  const name = layoutNameKey(saveName.value.trim());
  const exists = entries.some((entry) => layoutNameKey(entry.name) === name);
  $("save-yard").textContent = exists ? "Update yard" : "Save yard";
}

function save() {
  try {
    localStorage.setItem(saveKey, JSON.stringify(toLegacy(layout)));
  } catch {
    // Keep the current layout usable in memory.
  }
}
function snapshot() {
  return structuredClone(layout);
}
function commit(previous: Layout) {
  undoStack.push(previous);
  if (undoStack.length > 35) undoStack.shift();
  save();
  updateStatus();
  redrawRails();
  redrawStock();
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
  ({ cols, rows } = layout.board);
  for (const button of children($("grid-sizes"))) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.cols) === cols));
  }
  const title = $("layout-name");
  title.textContent = layout.name;
  title.title = layout.name;
  $<HTMLButtonElement>("undo").disabled = !undoStack.length;
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
  return layout.background;
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
  const sample = document.createElement("canvas");
  sample.width = 216;
  sample.height = 126;
  sample.setAttribute("aria-hidden", "true");
  const context = context2d(sample);
  context.scale(sample.width / COLS, sample.height / ROWS);
  drawGround(context, key, COLS, ROWS);
  button.append(sample, name);
  button.onclick = () => {
    if (key !== background()) {
      const previous = snapshot();
      layout.background = key;
      drawGround(groundContext, key, cols, rows);
      commit(previous);
    }
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

function applyGrid(next: Layout) {
  const previous = snapshot();
  layout = next;
  hover = null;
  keyboardCell = [0, 0];
  commit(previous);
  resize();
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
    const next = resizeLayout(layout, size);
    if (next) return applyGrid(next);
    pendingSize = size;
    gridNote.textContent = "This yard is too wide or tall for " + dimensions.textContent + ".";
    gridNote.hidden = false;
    blankAtSize.textContent = "Start blank at " + dimensions.textContent;
    blankAtSize.hidden = false;
  };
  $("grid-sizes").append(button);
}

blankAtSize.onclick = () => {
  if (pendingSize) applyGrid(blankLayout(pendingSize, background()));
};

$("start-blank").onclick = () => {
  applyGrid(blankLayout(layout.board, background()));
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

function drawPreview(
  canvas: HTMLCanvasElement,
  type: TrackType | StockType,
  kind: PaletteKind,
  paint: ColorName = color,
  tile: Tile = { type: type as TrackType, turn: 0, branch: false },
) {
  const ctx = context2d(canvas);
  ctx.resetTransform();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  if (kind === "track") {
    ctx.scale(120, 120);
    drawTile(ctx, tile, -0.5, -0.5);
    if (tile.type === "tunnel") drawTunnelRoof(ctx, tile, -0.5, -0.5);
  } else {
    ctx.scale(220, 220);
    drawCar(ctx, { type: type as StockType, color: paint }, 0, 0);
  }
}
function preview(type: TrackType | StockType, kind: PaletteKind, paint?: ColorName, tile?: Tile) {
  const canvas = document.createElement("canvas");
  canvas.width = kind === "track" ? 144 : 176;
  canvas.height = kind === "track" ? 128 : 120;
  canvas.setAttribute("aria-hidden", "true");
  drawPreview(canvas, type, kind, paint, tile);
  return canvas;
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
    card.append(preview(item.type, item.kind), label);
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
      drawPreview(card.firstElementChild as HTMLCanvasElement, piece, paletteKind);
    }
  }
  for (const swatch of children($("swatches")))
    swatch.setAttribute("aria-pressed", String(swatch.dataset.color === color));
  const hint = tracks
    ? "Drag tracks to place or move them. Tap to turn."
    : "Drag cars onto the rails. Drop an engine on a train to join it.";
  $("tool-hint").innerHTML = icon("touch") + hint;
  redrawRails();
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
  for (const canvas of canvasLayers) {
    canvas.width = Math.max(1, Math.round(cell * cols * dpr));
    canvas.height = Math.max(1, Math.round(cell * rows * dpr));
    context2d(canvas).setTransform(canvas.width / cols, 0, 0, canvas.height / rows, 0, 0);
  }
  drawGround(groundContext, background(), cols, rows);
  redrawRails();
  redrawStock();
}

function occupiedSquares() {
  return new Set(stockFrame.flatMap((cars) => cars.map((car) => car.index)));
}

function movesTrack(item: Item | null): item is TrackMove {
  return item?.kind === "track" || Boolean(item?.tile);
}

function trackEdits(item: TrackMove, index: number): GridEdit[] | null {
  const occupied = occupiedSquares();
  if (occupied.has(index)) return null;
  const { board } = layout;
  if (!item.tile) return fitTrack(board, index, item.type, occupied, null);
  const source = item.index;
  if (source === index || board.grid[source] !== item.tile || occupied.has(source)) return null;
  const grid = board.grid.slice();
  grid[source] = null;
  const moved: TrackEdit[] = fitTrack({ ...board, grid }, index, item.type, occupied, item.tile);
  return [[source, null], ...moved];
}

function redrawRails() {
  railsContext.clearRect(0, 0, cols, rows);
  roofContext.clearRect(0, 0, cols, rows);
  const trackDrop = hover && movesTrack(drag) ? drag : null;
  const edits = trackDrop && hover ? trackEdits(trackDrop, hover.index) : null;
  const grid = edits ? layout.board.grid.slice() : layout.board.grid;
  for (const [index, tile] of edits ?? []) grid[index] = tile;
  const board: Board = { ...layout.board, grid };
  const draw = (index: number, tile: Tile) => {
    const visible = isSwitch(tile) ? { ...tile, branch: switchBranch(board, index, tile) } : tile;
    drawTile(railsContext, visible, ...cellAt(index, cols), board);
  };
  for (const [index, tile] of grid.entries()) {
    if (tile && index !== hover?.index) draw(index, tile);
  }
  drawTunnelRoofs(roofContext, board);
  if (!hover) return;
  const { column, row, index } = hover;
  const tile = grid[index];
  const valid = trackDrop ? Boolean(edits) || trackDrop.index === index : Boolean(tile);
  railsContext.fillStyle = valid ? "#fff2b883" : "#c7705959";
  railsContext.fillRect(column, row, 1, 1);
  railsContext.strokeStyle = valid ? "#935e2d" : "#9b4538";
  railsContext.lineWidth = 0.05;
  railsContext.strokeRect(column + 0.025, row + 0.025, 0.95, 0.95);
  if (tile) draw(index, tile);
  if (valid && drag?.kind === "cars") {
    const preview = startTrain(
      layout.board,
      index,
      { type: drag.type, color: drag.color },
      hover.x - column,
      hover.y - row,
    )!;
    const [car] = carPositions(preview, cols);
    railsContext.globalAlpha = 0.73;
    drawCar(railsContext, car, car.x, car.y, car.angle);
    railsContext.globalAlpha = 1;
  }
}
function drawTunnelRoofs(ctx: CanvasRenderingContext2D, board: Board) {
  for (const [index, tile] of board.grid.entries()) {
    if (tile?.type === "tunnel") drawTunnelRoof(ctx, tile, ...cellAt(index, board.cols), board);
  }
}

function redrawStock(now = performance.now(), emitSmoke = false) {
  stockContext.clearRect(0, 0, cols, rows);
  if (smokeLayout !== layout) {
    smokeLayout = layout;
    smokePuffs = [];
    lastPuff = new WeakMap();
  }
  stockFrame = layout.trains.map((train) => carPositions(train, cols));
  for (const [trainIndex, cars] of stockFrame.entries()) {
    const train = layout.trains[trainIndex];
    for (const [carIndex, car] of cars.entries()) {
      const vehicle = train.cars[carIndex];
      const swing =
        activeCrane?.car === vehicle ? (now - activeCrane.start) / craneSwingDuration : 0;
      const angle = Math.sin(Math.PI * Math.max(0, Math.min(1, swing))) * 1.65;
      drawCar(stockContext, car, car.x, car.y, car.angle, angle);
      if (
        emitSmoke &&
        car.type === "steam" &&
        movingTrains.has(train) &&
        now - (lastPuff.get(vehicle) ?? -Infinity) >= 260 / Math.sqrt(speed)
      ) {
        const puff = steamPuff(car);
        if (!underTunnelRoof(layout.board, puff.x, puff.y)) {
          lastPuff.set(vehicle, now);
          smokePuffs.push({ ...puff, start: now, drift: (Math.random() - 0.35) * 0.13 });
        }
      }
    }
  }
  smokePuffs = smokePuffs.filter((puff) => now - puff.start < puffLifetime);
  for (const puff of smokePuffs)
    drawSteamPuff(stockContext, puff, Math.max(0, now - puff.start) / puffLifetime);
}

function tick(now: number) {
  const seconds = lastFrame === undefined ? 0 : Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  const moving = speed && layout.trains.length && !drag?.moved;
  movingTrains.clear();
  if (moving) {
    sound.update(
      advance(
        layout.board,
        layout.trains,
        seconds * speed * 1.6,
        seconds,
        ringStation,
        recordMovement,
      ),
      speed,
    );
  } else {
    sound.stopRolling();
  }
  if (moving || activeCrane || smokePuffs.length) redrawStock(now, Boolean(moving));
  if (activeCrane && now - activeCrane.start >= craneSwingDuration) activeCrane = null;
  requestAnimationFrame(tick);
}

function locate(event: PointerEvent): Cell | null {
  const rect = rails.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * cols;
  const y = ((event.clientY - rect.top) / rect.height) * rows;
  const column = Math.floor(x);
  const row = Math.floor(y);
  if (column < 0 || column >= cols || row < 0 || row >= rows) return null;
  return { x, y, column, row, index: indexAt(column, row, cols) };
}

function hitCar(cell: Cell, bySquare = false) {
  if (underTunnelRoof(layout.board, cell.x, cell.y)) return null;
  let result: { trainIndex: number; carIndex: number } | null = null;
  let distance = 0.42;
  for (const [trainIndex, cars] of stockFrame.entries()) {
    for (const [carIndex, car] of cars.entries()) {
      const next = Math.hypot(cell.x - car.x, cell.y - car.y);
      if (next <= distance || (bySquare && car.index === cell.index && !result)) {
        distance = next;
        result = { trainIndex, carIndex };
      }
    }
  }
  return result;
}

function dropPiece(cell: Cell, item: TrackMove | CarPiece) {
  const { index } = cell;
  const tile = layout.board.grid[index];
  if (movesTrack(item)) {
    if (item.tile && index === item.index) return;
    const edits = trackEdits(item, index);
    if (!edits) return notify("Wait for the train to clear this square.");
    if (
      !item.tile &&
      edits.length === 1 &&
      tile?.type === item.type &&
      tile.turn === edits[0][1]?.turn
    )
      return;
    const previous = snapshot();
    for (const [square, track] of edits) layout.board.grid[square] = track;
    return commit(previous);
  }
  if (!tile) return notify("Drop the car on a track piece.");
  const car: Car = { type: item.type, color: item.color };
  const hit = hitCar(cell, isEngine(item.type));
  const previous = snapshot();
  if (isEngine(item.type) && !hit) {
    const train = startTrain(layout.board, index, car, cell.x - cell.column, cell.y - cell.row)!;
    const [engine] = carPositions(train, cols);
    if (
      stockFrame.some((cars) =>
        cars.some((other) => Math.hypot(other.x - engine.x, other.y - engine.y) < 0.66),
      )
    ) {
      return notify("Drop it onto the train to couple it, or try a clear square.");
    }
    layout.trains.push(train);
  } else {
    const train = hit
      ? layout.trains[hit.trainIndex]
      : nearestTrain(layout.board, layout.trains, index, cell.x - cell.column, cell.y - cell.row);
    if (!train) return notify("Add an engine to this track first.");
    const tenderPosition =
      item.type === "tender" && hit && train.cars[hit.carIndex]?.type === "steam"
        ? hit.carIndex + 1
        : undefined;
    const message = couple(layout.board, train, car, tenderPosition);
    if (message) return notify(message);
  }
  commit(previous);
}

function turnPiece(index: number) {
  const tile = layout.board.grid[index];
  if (!tile) return;
  const rotated = rotateTrack(layout.board, index);
  if (!rotated) return;
  if (rotated.turn !== tile.turn && occupiedSquares().has(index))
    return notify("Wait for the train to clear this square.");
  const previous = snapshot();
  layout.board.grid[index] = rotated;
  commit(previous);
}

function removePiece(item: BoardItem) {
  const { index } = item;
  if (item.train) {
    const { train, carIndex } = item;
    const trainIndex = layout.trains.indexOf(train);
    if (trainIndex === -1 || !train.cars[carIndex]) return;
    const previous = snapshot();
    train.cars.splice(carIndex, 1);
    if (!train.cars.some((car) => isEngine(car.type))) layout.trains.splice(trainIndex, 1);
    return commit(previous);
  }
  if (!layout.board.grid[index]) return;
  if (occupiedSquares().has(index)) return notify("Wait for the train to clear this square.");
  const previous = snapshot();
  layout.board.grid[index] = null;
  commit(previous);
}

function boardItem(cell: Cell): BoardItem {
  const hit = hitCar(cell, true);
  if (hit) {
    const train = layout.trains[hit.trainIndex];
    return {
      kind: "board",
      index: cell.index,
      train,
      carIndex: hit.carIndex,
      ...train.cars[hit.carIndex],
    };
  }
  const tile = layout.board.grid[cell.index];
  return tile
    ? { kind: "board", index: cell.index, tile, type: tile.type }
    : { kind: "board", index: cell.index, tile: null };
}

function tapBoard(cell: Cell, item: BoardItem = boardItem(cell)) {
  if (item.train && isEngine(item.type)) sound.call(item.type);
  else if (item.type === "crane" && item.train.cars[item.carIndex]?.type === "crane") {
    activeCrane = { car: item.train.cars[item.carIndex], start: performance.now() };
  } else turnPiece(cell.index);
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
    const kind = drag.kind === "board" ? (drag.train ? "cars" : "track") : drag.kind;
    ghost.append(preview(drag.type, kind, drag.color, drag.tile));
    document.body.append(ghost);
    removeZone.classList.toggle("available", drag.kind === "board");
  }
  hover = drag.kind === "board" && !drag.tile ? null : locate(event);
  removeZone.classList.toggle("targeted", drag.kind === "board" && overRemove(event));
  ghost.hidden = Boolean(hover);
  ghost.style.transform =
    "translate(" + (event.clientX - 36) + "px," + (event.clientY - 36) + "px)";
  redrawRails();
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
  redrawRails();
}

for (const surface of [palette, rails]) {
  surface.addEventListener("pointermove", moveDrag);
  surface.addEventListener("pointerup", endDrag);
  surface.addEventListener("pointercancel", endDrag);
  surface.addEventListener("lostpointercapture", endDrag);
}
rails.addEventListener("pointerdown", (event) => {
  const cell = locate(event);
  if (!cell) return;
  keyboardCell = [cell.column, cell.row];
  beginDrag(event, boardItem(cell));
});
rails.addEventListener("keydown", (event) => {
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
  redrawRails();
});
rails.addEventListener("blur", () => {
  hover = null;
  redrawRails();
});

$("track-tab").onclick = () => setPalette("track");
$("cars-tab").onclick = () => setPalette("cars");
$("undo").onclick = () => {
  if (!undoStack.length) return;
  layout = undoStack.pop()!;
  hover = null;
  keyboardCell = [0, 0];
  save();
  updateStatus();
  resize();
};
$("layouts").onclick = () => {
  resetGridNotice();
  dialog.returnValue = "cancel";
  dialog.showModal();
};
$("open-library").onclick = () => {
  dialog.close("library");
  saveName.value = layout.name;
  libraryEntries = listYards();
  libraryPage = 0;
  libraryNote.textContent = "";
  showLibrary();
  library.showModal();
};
saveName.oninput = () => updateSaveLabel(libraryEntries);
$("save-layout").onsubmit = (event) => {
  event.preventDefault();
  const name = saveName.value.trim().slice(0, 48);
  if (!name) {
    libraryNote.textContent = "Enter a name for your yard.";
    return;
  }
  try {
    storeYard({ ...snapshot(), name });
  } catch {
    libraryNote.textContent = "Could not save this yard. Try again.";
    return;
  }
  layout.name = name;
  save();
  updateStatus();
  library.close();
  notify("Saved " + name + ".");
};
const speedButtons = document.querySelectorAll<HTMLButtonElement>("[data-speed]");
document.querySelector('[data-speed="0"]')!.innerHTML = icon("pause");
function setSpeed(nextSpeed: number) {
  speed = nextSpeed;
  if (!speed) {
    sound.stopRolling();
    save();
  }
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
  if (document.hidden) save();
});
for (const gesture of ["gesturestart", "gesturechange", "gestureend", "wheel"]) {
  document.addEventListener(gesture, (event) => event.preventDefault(), { passive: false });
}
window.addEventListener("pagehide", save);

fillPalette();
updateSoundButton();
updateStatus();
resize();
new ResizeObserver(resize).observe(frame);
requestAnimationFrame(tick);
