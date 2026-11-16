/** What the player can build with: track pieces, rolling stock, colors and backgrounds. */
import type { Port } from "./railway.ts";

export interface Car {
  readonly type: StockType;
  readonly color: ColorName;
}

/** Catalogs list entries in palette order; `inPalette` entries appear in the palette. */
interface TrackInfo {
  name: string;
  paths: [Port, Port][];
  inPalette: boolean;
}
export const TRACK = {
  straight: { name: "Straight", paths: [[3, 1]], inPalette: true },
  curve: { name: "Curve", paths: [[1, 2]], inPalette: true },
  cross: {
    name: "Crossing",
    paths: [
      [3, 1],
      [0, 2],
    ],
    inPalette: true,
  },
  wye: {
    name: "Y-switch",
    paths: [
      [3, 0],
      [3, 2],
    ],
    inPalette: true,
  },
  left: {
    name: "Left switch",
    paths: [
      [3, 1],
      [3, 0],
    ],
    inPalette: true,
  },
  right: {
    name: "Right switch",
    paths: [
      [3, 1],
      [3, 2],
    ],
    inPalette: true,
  },
  station: { name: "Station", paths: [[3, 1]], inPalette: true },
  buffer: { name: "Buffer stop", paths: [[3, -1]], inPalette: true },
  bridge: { name: "Bridge", paths: [[3, 1]], inPalette: true },
  tunnel: { name: "Tunnel", paths: [[3, 1]], inPalette: true },
} satisfies Record<string, TrackInfo>;
export type TrackType = keyof typeof TRACK;

interface StockInfo {
  name: string;
  engine?: boolean;
  inPalette: boolean;
}
export const STOCK = {
  steam: { name: "Steam engine", engine: true, inPalette: true },
  diesel: { name: "Diesel engine", engine: true, inPalette: true },
  electric: { name: "Electric engine", engine: true, inPalette: true },
  tender: { name: "Coal tender", inPalette: true },
  hopper: { name: "Hopper", inPalette: true },
  log: { name: "Log car", inPalette: true },
  tank: { name: "Tank car", inPalette: true },
  box: { name: "Boxcar", inPalette: true },
  flat: { name: "Flatcar", inPalette: true },
  crane: { name: "Crane car", inPalette: true },
  passenger: { name: "Passenger coach", inPalette: true },
  caboose: { name: "Caboose", inPalette: true },
} satisfies Record<string, StockInfo>;
export type StockType = keyof typeof STOCK;

export type EngineType = {
  [T in StockType]: (typeof STOCK)[T] extends { engine: true } ? T : never;
}[StockType];

export const isEngine = (type: StockType): type is EngineType =>
  (STOCK[type] as StockInfo).engine === true;

const catalogKeys = <T extends string>(catalog: Record<T, { inPalette: boolean }>) =>
  (Object.keys(catalog) as T[]).filter((key) => catalog[key].inPalette);
export const TRACK_PALETTE: TrackType[] = catalogKeys(TRACK);
export const STOCK_PALETTE: StockType[] = catalogKeys(STOCK);

export const BACKGROUNDS = {
  plain: "Grass",
  meadow: "Meadow",
  coast: "Coast",
  mountain: "Mountains",
  desert: "Desert",
} satisfies Record<string, string>;
export type Background = keyof typeof BACKGROUNDS;

export function isBackground(value: unknown): value is Background {
  return typeof value === "string" && Object.hasOwn(BACKGROUNDS, value);
}
export const COLORS = {
  brick: ["Brick red", "#bb493b"],
  coral: ["Coral", "#dd765c"],
  amber: ["Golden yellow", "#d59832"],
  mint: ["Mint", "#7fa996"],
  pine: ["Pine green", "#427454"],
  teal: ["Teal", "#3f8581"],
  ocean: ["Ocean blue", "#3c719a"],
  violet: ["Plum", "#825878"],
  pink: ["Rose", "#bd6b8c"],
  cream: ["Cream", "#ede0bb"],
  brown: ["Chestnut", "#8b5b3d"],
  slate: ["Slate", "#535c66"],
} satisfies Record<string, [name: string, hex: string]>;
export type ColorName = keyof typeof COLORS;
