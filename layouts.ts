import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  COLORS,
  GRID_SIZES,
  STOCK,
  TRACK,
  expandStandardYard,
  gridSize,
  sampleLayout,
  segment,
} from "./src/railway.ts";
import type { Car, Grid, Layout, Segment, Train } from "./src/railway.ts";
import type { ServerResponse } from "node:http";
import { scenicPresets } from "./presets.ts";

const directory = process.env.LAYOUT_DIRECTORY ?? "/data";
const limit = 2 * 1024 * 1024;
await mkdir(directory, { recursive: true });

const integer = (value: unknown): value is number => Number.isInteger(value);
const finite = (value: unknown): value is number => Number.isFinite(value);
const validPort = (port: unknown): port is number => integer(port) && port >= -1 && port <= 3;
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const known = <T extends object>(choices: T, value: unknown): value is keyof T & string =>
  typeof value === "string" && Object.hasOwn(choices, value);

function yardName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  return name.length >= 1 && name.length <= 48 ? name : null;
}

function validate(payload: unknown): Layout | null {
  if (!record(payload)) return null;
  const layout = expandStandardYard(payload);
  const name = yardName(layout.name);
  if (
    (layout.cols !== undefined || layout.rows !== undefined) &&
    !GRID_SIZES.some(({ cols, rows }) => cols === layout.cols && rows === layout.rows)
  )
    return null;
  const { cols, rows } = gridSize(layout);
  const area = cols * rows;
  if (
    !name ||
    !Array.isArray(layout.grid) ||
    layout.grid.length !== area ||
    !Array.isArray(layout.trains) ||
    layout.trains.length > area
  )
    return null;
  const grid: Grid = [];
  for (const tile of layout.grid) {
    if (tile === null) {
      grid.push(null);
      continue;
    }
    if (
      !record(tile) ||
      !known(TRACK, tile.type) ||
      !integer(tile.turn) ||
      tile.turn < 0 ||
      tile.turn > 3
    )
      return null;
    grid.push({ type: tile.type, turn: tile.turn, branch: tile.branch === true });
  }
  const trains: Train[] = [];
  for (const train of layout.trains) {
    if (
      !record(train) ||
      !Array.isArray(train.cars) ||
      !train.cars.length ||
      train.cars.length > 24 ||
      !Array.isArray(train.history) ||
      !train.history.length ||
      train.history.length > area * 4 ||
      !finite(train.progress) ||
      train.progress < 0
    )
      return null;
    const cars: Car[] = [];
    for (const car of train.cars) {
      if (!record(car) || !known(STOCK, car.type) || !known(COLORS, car.color)) return null;
      cars.push({ type: car.type, color: car.color });
    }
    if (!cars.some((car) => STOCK[car.type].engine)) return null;
    const history: Segment[] = [];
    for (const path of train.history) {
      if (
        !record(path) ||
        !integer(path.index) ||
        path.index < 0 ||
        path.index >= area ||
        !validPort(path.from) ||
        !validPort(path.to) ||
        path.from === path.to
      )
        return null;
      history.push(segment(path.index, path.from, path.to));
    }
    if (train.progress > history.at(-1)!.length) return null;
    trains.push({ cars, history, progress: train.progress });
  }
  const result: Layout = { name, cols, rows, grid, trains, landscape: layout.landscape === true };
  const backgrounds = ["plain", "meadow", "coast", "mountain", "desert"];
  if (typeof layout.background === "string" && backgrounds.includes(layout.background)) {
    result.background = layout.background;
  }
  return result;
}

function filename(name: string) {
  const id = createHash("sha256").update(name.toLowerCase()).digest("hex");
  return join(directory, id + ".json");
}

async function listLayouts(includePreviews: boolean) {
  const files = (await readdir(directory)).filter((file) => /^[a-f0-9]{64}\.json$/.test(file));
  const layouts = await Promise.all(
    files.map(async (file) =>
      expandStandardYard<Layout>(JSON.parse(await readFile(join(directory, file), "utf8"))),
    ),
  );
  layouts.sort((a, b) => a.name.localeCompare(b.name));
  return includePreviews ? layouts : layouts.map(({ name }) => ({ name }));
}

function errorCode(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code;
}

async function writeLayout(layout: Layout, importing: boolean) {
  const path = filename(layout.name);
  if (importing) {
    try {
      const stored = validate(JSON.parse(await readFile(path, "utf8")));
      // An unreadable or invalid stored yard is a storage error, not a name conflict.
      if (!stored) throw new Error("Invalid stored yard: " + path);
      return JSON.stringify({ ...layout, name: stored.name }) === JSON.stringify(stored);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  const temporary = join(directory, "." + randomUUID() + ".tmp");
  try {
    await writeFile(temporary, JSON.stringify(layout) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return true;
}

// Serialize imports and writes so an import can never replace an existing save.
let writes: Promise<unknown> = Promise.resolve();
function queueWrite(layout: Layout, importing: boolean) {
  const write = writes.then(() => writeLayout(layout, importing));
  writes = write.catch(() => {});
  return write;
}

function respond(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

for (const preset of [sampleLayout(), ...scenicPresets()]) {
  await writeLayout(validate(preset)!, true);
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "", "http://localhost");
    if (url.pathname !== "/api/layouts") return respond(response, 404, { error: "Not found" });
    if (request.method === "GET") {
      if (!url.searchParams.has("name"))
        return respond(response, 200, await listLayouts(url.searchParams.has("previews")));
      const name = yardName(url.searchParams.get("name"));
      if (!name) return respond(response, 400, { error: "Invalid yard name" });
      try {
        const layout = expandStandardYard(JSON.parse(await readFile(filename(name), "utf8")));
        return respond(response, 200, layout);
      } catch (error) {
        if (errorCode(error) === "ENOENT")
          return respond(response, 404, { error: "Yard not found" });
        throw error;
      }
    }
    if (request.method !== "PUT") return respond(response, 405, { error: "Method not allowed" });
    if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
      return respond(response, 415, { error: "Expected JSON" });
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    }
    if (size > limit) return respond(response, 413, { error: "Yard is too large" });
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return respond(response, 400, { error: "Invalid JSON" });
    }
    const layout = validate(payload);
    if (!layout) return respond(response, 400, { error: "Invalid yard" });
    const stored = await queueWrite(layout, url.searchParams.has("import"));
    respond(
      response,
      stored ? 200 : 409,
      stored ? { name: layout.name } : { error: "Yard already exists" },
    );
  } catch (error) {
    console.error("Yard storage error:", error);
    respond(response, 500, { error: "Yard storage is unavailable" });
  }
}).listen(3000, "0.0.0.0");
