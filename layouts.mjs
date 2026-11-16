import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir, rename, unlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {COLORS, GRID_SIZES, STOCK, TRACK, expandStandardYard, gridSize, sampleLayout, segment} from './src/railway.mjs';
import {scenicPresets} from './presets.mjs';

const directory = process.env.LAYOUT_DIRECTORY ?? '/data';
const limit = 2 * 1024 * 1024;
await mkdir(directory, {recursive: true});

const validPort = port => Number.isInteger(port) && port >= -1 && port <= 3;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const known = (choices, value) => typeof value === 'string' && Object.hasOwn(choices, value);

function yardName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  return name.length >= 1 && name.length <= 48 ? name : null;
}

function validate(payload) {
  if (!record(payload)) return null;
  const layout = expandStandardYard(payload);
  const name = yardName(layout.name);
  if ((layout.cols !== undefined || layout.rows !== undefined) &&
      !GRID_SIZES.some(({cols, rows}) => cols === layout.cols && rows === layout.rows)) return null;
  const {cols, rows} = gridSize(layout);
  const area = cols * rows;
  if (!name || !Array.isArray(layout.grid) || layout.grid.length !== area ||
      !Array.isArray(layout.trains) || layout.trains.length > area) return null;
  const grid = [];
  for (const tile of layout.grid) {
    if (tile === null) {
      grid.push(null);
      continue;
    }
    if (!record(tile) || !known(TRACK, tile.type) || !Number.isInteger(tile.turn) ||
        tile.turn < 0 || tile.turn > 3) return null;
    grid.push({type: tile.type, turn: tile.turn, branch: tile.branch === true});
  }
  const trains = [];
  for (const train of layout.trains) {
    if (!record(train) || !Array.isArray(train.cars) || !train.cars.length || train.cars.length > 24 ||
        !Array.isArray(train.history) || !train.history.length || train.history.length > area * 4 ||
        !Number.isFinite(train.progress) || train.progress < 0) return null;
    const cars = [];
    for (const car of train.cars) {
      if (!record(car) || !known(STOCK, car.type) || !known(COLORS, car.color)) return null;
      cars.push({type: car.type, color: car.color});
    }
    if (!cars.some(car => STOCK[car.type].engine)) return null;
    const history = [];
    for (const path of train.history) {
      if (!record(path) || !Number.isInteger(path.index) || path.index < 0 || path.index >= area || !validPort(path.from) ||
          !validPort(path.to) || path.from === path.to) return null;
      history.push(segment(path.index, path.from, path.to));
    }
    if (train.progress > history.at(-1).length) return null;
    trains.push({cars, history, progress: train.progress});
  }
  const result = {name, cols, rows, grid, trains, landscape: layout.landscape === true};
  if (['plain', 'meadow', 'coast', 'mountain', 'desert'].includes(layout.background)) {
    result.background = layout.background;
  }
  return result;
}

function filename(name) {
  const id = createHash('sha256').update(name.toLowerCase()).digest('hex');
  return join(directory, id + '.json');
}

async function listLayouts(includePreviews) {
  const files = (await readdir(directory)).filter(file => /^[a-f0-9]{64}\.json$/.test(file));
  const layouts = await Promise.all(files.map(async file => expandStandardYard(JSON.parse(await readFile(join(directory, file), 'utf8')))));
  layouts.sort((a, b) => a.name.localeCompare(b.name));
  return includePreviews ? layouts : layouts.map(({name}) => ({name}));
}

async function writeLayout(layout, importing) {
  const path = filename(layout.name);
  if (importing) {
    try {
      const stored = validate(JSON.parse(await readFile(path, 'utf8')));
      return JSON.stringify({...layout, name: stored.name}) === JSON.stringify(stored);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const temporary = join(directory, '.' + randomUUID() + '.tmp');
  try {
    await writeFile(temporary, JSON.stringify(layout) + '\n', {flag: 'wx', mode: 0o600});
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return true;
}

// Serialize imports and writes so an import can never replace an existing save.
let writes = Promise.resolve();
function queueWrite(layout, importing) {
  const write = writes.then(() => writeLayout(layout, importing));
  writes = write.catch(() => {});
  return write;
}

function respond(response, status, data) {
  response.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
  response.end(JSON.stringify(data));
}

for (const preset of [sampleLayout(), ...scenicPresets()]) {
  await writeLayout(validate(preset), true);
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/api/layouts') return respond(response, 404, {error: 'Not found'});
    if (request.method === 'GET') {
      if (!url.searchParams.has('name')) return respond(response, 200, await listLayouts(url.searchParams.has('previews')));
      const name = yardName(url.searchParams.get('name'));
      if (!name) return respond(response, 400, {error: 'Invalid yard name'});
      try {
        const layout = expandStandardYard(JSON.parse(await readFile(filename(name), 'utf8')));
        return respond(response, 200, layout);
      } catch (error) {
        if (error.code === 'ENOENT') return respond(response, 404, {error: 'Yard not found'});
        throw error;
      }
    }
    if (request.method !== 'PUT') return respond(response, 405, {error: 'Method not allowed'});
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
      return respond(response, 415, {error: 'Expected JSON'});
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    }
    if (size > limit) return respond(response, 413, {error: 'Yard is too large'});
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
      return respond(response, 400, {error: 'Invalid JSON'});
    }
    const layout = validate(payload);
    if (!layout) return respond(response, 400, {error: 'Invalid yard'});
    const stored = await queueWrite(layout, url.searchParams.has('import'));
    respond(response, stored ? 200 : 409, stored ? {name: layout.name} : {error: 'Yard already exists'});
  } catch (error) {
    console.error('Yard storage error:', error);
    respond(response, 500, {error: 'Yard storage is unavailable'});
  }
}).listen(3000, '0.0.0.0');
