import { BACKGROUNDS, COLORS, STOCK, STOCK_PALETTE, TRACK, TRACK_PALETTE } from "./catalog.ts";
import type { Background, ColorName, StockType, TrackType } from "./catalog.ts";
import type {
  BoardFraction,
  HeldPiece,
  PageEdit,
  PalettePiece,
  PictureSpec,
  Status,
} from "./engine/protocol.ts";
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
import type { Refusal } from "./model/edits.ts";
import { MAX_CARS } from "./model/train.ts";
import { GRID_SIZES } from "./railway.ts";
import type { GridSize, Point } from "./railway.ts";
import { blankSaved } from "./saves.ts";
import type { SavedYard } from "./saves.ts";
import { TrainSound } from "./sound.ts";
import { connectWorker } from "./worker-client.ts";

/*
 * The page: DOM, pointer input, sound and yard libraries. The yard itself, the trains, undo and
 * all drawing live in the yard worker (src/engine), which the page talks to only by message.
 */

type PaletteKind = "track" | "cars";

/** A pointer drag of a palette piece or something on the board. */
interface Drag {
  id: number;
  x: number;
  y: number;
  fromBoard: boolean;
  moved: boolean;
  /** What the worker says is held; undefined until it answers, null for an empty square. */
  piece: HeldPiece | null | undefined;
  ghost: HTMLDivElement | null;
}

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
const map = $("map");
const yardCanvas = $<HTMLCanvasElement>("yard-canvas");
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
/** What the worker last reported; null until it first does. */
let status: Status | null = null;
let paletteKind: PaletteKind = "track";
let color: ColorName = "brick";
let speed = 1;
/** The engine types rolling, for the rolling sound. */
let rolling: ReadonlySet<string> = new Set();
let keyboardSquare: Point = [0, 0];
let drag: Drag | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

let libraryEntries: SavedYard[] = [];
let libraryPage = 0;
const yardsPerPage = 5;

/* The yard worker ----------------------------------------------------------------------- */

const { send, request } = connectWorker(
  new Worker(new URL("./engine/worker.ts", import.meta.url), { type: "module" }),
  (event) => {
    switch (event.type) {
      case "status":
        return applyStatus(event.status);
      case "refused":
        return refuse(event.reason);
      case "rolling":
        rolling = new Set(event.engines);
        return sound.update(rolling, speed);
      case "call":
        return sound.call(event.sound);
    }
  },
);
// The worker draws the board canvas from here on.
const screen = yardCanvas.transferControlToOffscreen();
send({ type: "init", canvas: screen }, [screen]);

/** Applies an edit. The worker reports a refusal itself, so only a failure needs telling here. */
function edit(change: PageEdit) {
  return request("edit", { edit: change }).catch(() => {
    notify("Something went wrong. Try again.");
    return null;
  });
}

/* Pictures ------------------------------------------------------------------------------ */

/** Asks the worker for a picture and resolves to an image URL for it. */
async function pictureUrl(spec: PictureSpec) {
  return URL.createObjectURL(await request("picture", { spec }));
}

/** The URL each image is waiting for, so a slow, outdated picture never replaces a newer one. */
const awaitedImages = new WeakMap<HTMLImageElement, Promise<string>>();
async function showImage(image: HTMLImageElement, url: Promise<string>) {
  awaitedImages.set(image, url);
  let src: string;
  try {
    src = await url;
  } catch {
    // A picture that fails to draw leaves the image blank.
    return;
  }
  if (awaitedImages.get(image) === url) image.src = src;
}
/** A decorative image that shows the picture once it is ready. */
function picture(url: Promise<string>) {
  const image = document.createElement("img");
  image.alt = "";
  image.draggable = false;
  void showImage(image, url);
  return image;
}

/** Piece pictures by kind, type, turn and color; there are few, so they are kept for reuse. */
const piecePictures = new Map<string, Promise<string>>();
function piecePicture(piece: HeldPiece) {
  const key =
    piece.kind === "track"
      ? [piece.kind, piece.tile.type, piece.tile.turn, piece.tile.branch].join()
      : [piece.kind, piece.type, piece.color].join();
  let url = piecePictures.get(key);
  if (!url) piecePictures.set(key, (url = pictureUrl({ kind: "piece", piece })));
  return url;
}

function paletteItem(type: TrackType | StockType): PalettePiece {
  return paletteKind === "track"
    ? { kind: "track", type: type as TrackType }
    : { kind: "cars", type: type as StockType, color };
}

function heldPiece(item: PalettePiece): HeldPiece {
  return item.kind === "track"
    ? { kind: "track", tile: { type: item.type, turn: 0, branch: false } }
    : item;
}

/** Thumbnails shown in the library; they are released when the page of yards changes. */
let thumbnails: HTMLImageElement[] = [];

function releaseThumbnails() {
  for (const image of thumbnails) {
    const url = awaitedImages.get(image);
    // Forget the picture first, so a thumbnail still being painted never loads a released URL.
    awaitedImages.delete(image);
    if (url) void revokeWhenReady(url);
  }
  thumbnails = [];
}

async function revokeWhenReady(url: Promise<string>) {
  try {
    URL.revokeObjectURL(await url);
  } catch {
    // A picture that failed to draw has no URL to release.
  }
}

/* Library ------------------------------------------------------------------------------- */

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

/** The built-in yards, asked for once. */
let builtIns: Promise<readonly SavedYard[]> | undefined;
const builtInYards = () => (builtIns ??= request("builtIns", {}));

const byName = (yards: Iterable<SavedYard>) =>
  [...yards].sort((a, b) => a.name.localeCompare(b.name));

/** The built-in yards and those in the current library, which replace built-ins with the same name. */
async function listYards() {
  const yards = new Map<string, SavedYard>();
  for (const yard of [...(await builtInYards()), ...(await yardLibrary.list())]) {
    yards.set(yardNameKey(yard.name), yard);
  }
  return byName(yards.values());
}

function showLibrary() {
  const start = libraryPage * yardsPerPage;
  const pages = Math.max(1, Math.ceil(libraryEntries.length / yardsPerPage));
  const fresh = blankSaved("New Layout", currentSize(), background());
  const entries = [fresh, ...libraryEntries.slice(start, start + yardsPerPage)];
  savedLayouts.replaceChildren();
  releaseThumbnails();
  entries.forEach((yard, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "saved-yard";
    const thumbnail = picture(pictureUrl({ kind: "yard", yard }));
    thumbnails.push(thumbnail);
    const caption = document.createElement("span");
    caption.textContent = index === 0 ? "New yard" : yard.name;
    button.append(thumbnail, caption);
    button.onclick = () => {
      void edit({ type: "replace", yard });
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

function updateSaveLabel(entries: readonly SavedYard[]) {
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
  // The layouts dialog explains this one next to the size buttons.
  "too-big-for-size": "",
  "no-change": "",
};

function refuse(reason: Refusal) {
  if (refusalMessages[reason]) notify(refusalMessages[reason]);
}

/** The toast is a manual popover, so it shows in the top layer, above any open dialog. */
const toast = $("toast");

function notify(message: string) {
  toast.textContent = message;
  if (!toast.matches(":popover-open")) toast.showPopover();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.hidePopover(), 2300);
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Runs a DOM update inside a view transition, unless the player prefers reduced motion. `kind` is
 * set on the root while it runs, so the stylesheet can give elements names for that kind alone.
 */
async function transition(kind: string, update: () => void) {
  if (reducedMotion.matches) return update();
  const root = document.documentElement;
  root.dataset.transition = kind;
  try {
    await document.startViewTransition(update).finished;
  } catch {
    // A skipped transition has still applied the update.
  } finally {
    if (root.dataset.transition === kind) delete root.dataset.transition;
  }
}

/* Status -------------------------------------------------------------------------------- */

const currentSize = (): GridSize => status ?? GRID_SIZES[0];
const background = (): Background => status?.background ?? "plain";

function applyStatus(next: Status) {
  const resized = next.cols !== status?.cols || next.rows !== status.rows;
  status = next;
  if (next.resetFocus) keyboardSquare = [0, 0];
  for (const button of children($("grid-sizes"))) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.cols) === next.cols));
  }
  const title = $("layout-name");
  title.textContent = next.name;
  title.title = next.name;
  $<HTMLButtonElement>("undo").disabled = !next.canUndo;
  for (const button of children($("backgrounds"))) {
    button.setAttribute("aria-pressed", String(button.dataset.background === next.background));
  }
  if (resized) updateCoordinates(next.cols, next.rows);
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
library.querySelector(".close")!.innerHTML = icon("close");

for (const [key, name] of Object.entries(BACKGROUNDS) as [Background, string][]) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "background-option";
  button.dataset.background = key;
  button.append(picture(pictureUrl({ kind: "ground", background: key })), name);
  button.onclick = () => {
    void edit({ type: "setBackground", background: key });
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
  void edit({ type: "replace", yard: blankSaved("New Layout", size, background()) });
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
  button.onclick = async () => {
    resetGridNotice();
    if (size.cols === currentSize().cols) return;
    const result = await edit({ type: "resize", size });
    if (result?.ok) return dialog.close("grid-size");
    if (result?.reason !== "too-big-for-size") return;
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
  startBlank(currentSize());
  setPalette("track");
};

function updateCoordinates(cols: number, rows: number) {
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

/* Palette ------------------------------------------------------------------------------- */

function fillPalette() {
  const types = paletteKind === "track" ? TRACK_PALETTE : STOCK_PALETTE;
  palette.dataset.kind = paletteKind;
  palette.replaceChildren();
  for (const type of types) {
    const card = document.createElement("div");
    card.className = "piece";
    card.dataset.piece = type;
    const label = document.createElement("span");
    label.textContent =
      paletteKind === "track" ? TRACK[type as TrackType].name : STOCK[type as StockType].name;
    card.append(picture(piecePicture(heldPiece(paletteItem(type)))), label);
    // The item is read when the drag starts, so it carries the color chosen by then.
    card.addEventListener("pointerdown", (event) =>
      beginDrag(event, paletteItem(type as TrackType | StockType)),
    );
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
      void showImage(
        card.firstElementChild as HTMLImageElement,
        piecePicture(heldPiece(paletteItem(piece))),
      );
    }
  }
  for (const swatch of children($("swatches")))
    swatch.setAttribute("aria-pressed", String(swatch.dataset.color === color));
  const hint = tracks
    ? "Drag tracks to place or move them. Tap to turn."
    : "Drag cars onto the rails. Drop an engine on a train to join it.";
  $("tool-hint").innerHTML = icon("touch") + hint;
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
  void transition("palette", fillPalette);
}

/* Board --------------------------------------------------------------------------------- */

/**
 * Tells the worker the board's size in device pixels. The stylesheet sizes the board to fit its
 * frame, so this only reports what layout decided.
 */
function resize([entry]: ResizeObserverEntry[]) {
  const [box] = entry.contentBoxSize;
  const dpr = Math.min(2, window.devicePixelRatio);
  send({
    type: "resize",
    width: Math.max(1, Math.round(box.inlineSize * dpr)),
    height: Math.max(1, Math.round(box.blockSize * dpr)),
  });
}

/** Where the pointer is on the board, or null when it is off it. */
function boardFraction(event: PointerEvent): BoardFraction | null {
  const rect = yardCanvas.getBoundingClientRect();
  const u = (event.clientX - rect.left) / rect.width;
  const v = (event.clientY - rect.top) / rect.height;
  return u >= 0 && u < 1 && v >= 0 && v < 1 ? [u, v] : null;
}

function beginDrag(event: PointerEvent, from: PalettePiece | BoardFraction) {
  if (!event.isPrimary || event.button !== 0 || drag) return;
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
  const current: Drag = (drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    fromBoard: !("kind" in from),
    moved: false,
    piece: undefined,
    ghost: null,
  });
  void grabPiece(current, from);
}

/** Asks the worker what the drag picked up. */
async function grabPiece(current: Drag, from: PalettePiece | BoardFraction) {
  try {
    current.piece = await request("grab", { from });
  } catch {
    current.piece = null;
    return;
  }
  // Start painting the drag picture now, so it is ready once the pointer moves.
  if (current.piece) void warmPicture(current.piece);
}

async function warmPicture(piece: HeldPiece) {
  try {
    await piecePicture(piece);
  } catch {
    // The drag shows no picture, as if it were still painting.
  }
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
  const at = boardFraction(event);
  send({ type: "drag", at });
  const { piece } = drag;
  if (!piece) return;
  let ghost = drag.ghost;
  if (!ghost) {
    ghost = drag.ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.append(picture(piecePicture(piece)));
    document.body.append(ghost);
    removeZone.classList.toggle("available", drag.fromBoard);
  }
  // Over the board, the board shows where the piece would land; cars lifted off it show nothing.
  const marksBoard = Boolean(at) && !(drag.fromBoard && piece.kind === "cars");
  removeZone.classList.toggle("targeted", drag.fromBoard && overRemove(event));
  ghost.hidden = marksBoard;
  ghost.style.transform =
    "translate(" + (event.clientX - 36) + "px," + (event.clientY - 36) + "px)";
}

function endDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return;
  const { ghost, moved, fromBoard } = drag;
  ghost?.remove();
  drag = null;
  removeZone.classList.toggle("available", false);
  removeZone.classList.toggle("targeted", false);
  if (event.type === "pointerup") {
    send({
      type: "release",
      at: boardFraction(event),
      remove: fromBoard && moved && overRemove(event),
    });
  } else {
    send({ type: "cancel" });
  }
}

for (const surface of [palette, yardCanvas]) {
  surface.addEventListener("pointermove", moveDrag);
  surface.addEventListener("pointerup", endDrag);
  surface.addEventListener("pointercancel", endDrag);
  surface.addEventListener("lostpointercapture", endDrag);
}
yardCanvas.addEventListener("pointerdown", (event) => {
  const at = boardFraction(event);
  if (!at || !status) return;
  keyboardSquare = [Math.floor(at[0] * status.cols), Math.floor(at[1] * status.rows)];
  beginDrag(event, at);
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
  if (!status) return;
  if (step) {
    keyboardSquare = [
      Math.max(0, Math.min(status.cols - 1, keyboardSquare[0] + step[0])),
      Math.max(0, Math.min(status.rows - 1, keyboardSquare[1] + step[1])),
    ];
  }
  const removing = event.key === "Delete" || event.key === "Backspace";
  send({
    type: "keyboard",
    square: keyboardSquare,
    ...(!step && { action: removing ? "remove" : "tap" }),
  });
});
yardCanvas.addEventListener("blur", () => send({ type: "keyboard", square: null }));

$("track-tab").onclick = () => setPalette("track");
$("cars-tab").onclick = () => setPalette("cars");
$("undo").onclick = () => send({ type: "undo" });
// The Layouts button opens the dialog with `command="show-modal"`; reset it as it opens.
dialog.addEventListener("command", (event) => {
  if (!(event instanceof CommandEvent) || event.command !== "show-modal") return;
  resetGridNotice();
  dialog.returnValue = "cancel";
});
const librarySelect = $<HTMLSelectElement>("library-select");
const removeLibraryButton = $<HTMLButtonElement>("remove-library");
const s3Form = $<HTMLFormElement>("s3-library");
/** Counts library loads, so a slow one that finishes after a newer one is ignored. */
let libraryLoad = 0;

function fillLibrarySelect() {
  const libraries = readLibraries(settingsStore);
  const options = libraries.map((settings) => {
    const option = document.createElement("option");
    option.value = settings.id;
    const name = document.createElement("span");
    name.textContent = settings.name;
    option.append(name);
    if (settings.kind === "s3") {
      const kind = document.createElement("span");
      kind.className = "library-kind";
      kind.textContent = "S3";
      // The space keeps the option's text, and so its accessible name, as "Name S3".
      option.append(" ", kind);
    }
    return option;
  });
  // Keep the picker's button, which shows the chosen option through <selectedcontent>.
  for (const option of librarySelect.querySelectorAll("option")) option.remove();
  librarySelect.append(...options);
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
  libraryEntries = [];
  libraryPage = 0;
  libraryNote.textContent = "Loading " + current.settings.name + "…";
  showLibrary();
  const builtIn = await builtInYards().catch(() => []);
  if (load !== libraryLoad) return;
  libraryEntries = byName(builtIn);
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
  const settings: NewLibrary = {
    kind: "s3",
    name: field("name"),
    bucketUrl: field("bucketUrl"),
    accessKeyId: field("accessKeyId"),
    secretAccessKey: field("secretAccessKey"),
    region: field("region") || "us-east-1",
    keyPrefix: field("keyPrefix") || "trainyard/",
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
  saveName.value = status?.name ?? "";
  fillLibrarySelect();
  void reloadLibrary();
  void transition("dialog", () => {
    dialog.close("library");
    library.showModal();
  });
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
    const yard = await request("yard", {});
    await yardLibrary.save({ ...yard, name });
  } catch {
    libraryNote.textContent =
      "Could not save this yard to " + yardLibrary.settings.name + ". Try again.";
    return;
  } finally {
    saveButton.disabled = false;
  }
  void edit({ type: "rename", name });
  library.close();
  notify("Saved " + name + " to " + yardLibrary.settings.name + ".");
};
const speedButtons = document.querySelectorAll<HTMLButtonElement>("[data-speed]");
document.querySelector('[data-speed="0"]')!.innerHTML = icon("pause");
function setSpeed(nextSpeed: number) {
  speed = nextSpeed;
  send({ type: "speed", speed });
  if (speed) sound.update(rolling, speed);
  else sound.stopRolling();
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

fillPalette();
updateSoundButton();
new ResizeObserver(resize).observe(yardCanvas);
