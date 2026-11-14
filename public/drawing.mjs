import {COLS, ROWS, COLORS, isSwitch, pointOn, segment, trackPaths} from './railway.mjs';

const SCENE_ROWS = 12;

function randomSource(seed) {
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function oval(ctx, x, y, rx, ry, color) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
}

function line(ctx, points, color, width) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function rounded(ctx, x, y, w, h, r, fill, stroke, width = 0.018) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function pine(ctx, x, y, scale, shade) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  oval(ctx, 0.05, 0.12, 0.22, 0.10, '#657c4f40');
  rounded(ctx, -0.035, -0.1, 0.07, 0.25, 0.02, '#7e6246');
  for (let i = 0; i < 3; i += 1) {
    const top = -0.22 - i * 0.12;
    const span = 0.20 - i * 0.043;
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.quadraticCurveTo(span * 0.47, top + 0.13, span, top + 0.28);
    ctx.quadraticCurveTo(0, top + 0.34, -span, top + 0.28);
    ctx.quadraticCurveTo(-span * 0.47, top + 0.13, 0, top);
    ctx.fillStyle = shade[i];
    ctx.fill();
  }
  ctx.restore();
}

function pond(ctx) {
  ctx.save();
  ctx.translate(9.48, 6.94);
  ctx.beginPath();
  ctx.moveTo(-1.43, 0.18);
  ctx.bezierCurveTo(-1.56, -0.43, -0.90, -0.91, -0.23, -0.71);
  ctx.bezierCurveTo(0.37, -0.50, 0.58, -0.91, 1.07, -0.57);
  ctx.bezierCurveTo(1.83, -0.06, 1.39, 0.65, 0.72, 0.70);
  ctx.bezierCurveTo(0.24, 0.75, -0.02, 0.53, -0.49, 0.69);
  ctx.bezierCurveTo(-1.08, 0.87, -1.41, 0.60, -1.43, 0.18);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.30;
  ctx.strokeStyle = '#a7bd8b';
  ctx.stroke();
  ctx.lineWidth = 0.12;
  ctx.strokeStyle = '#e0d7ab';
  ctx.stroke();
  const water = ctx.createLinearGradient(0, -0.8, 0, 0.8);
  water.addColorStop(0, '#8ebcaa');
  water.addColorStop(1, '#6caa9d');
  ctx.fillStyle = water;
  ctx.fill();
  ctx.lineCap = 'round';
  for (const [x, y, w] of [[-0.97, 0.01, 0.29], [-0.47, 0.31, 0.22], [0.20, -0.25, 0.39], [0.68, 0.29, 0.33], [0.90, -0.10, 0.20]]) {
    line(ctx, [[x, y], [x + w, y]], '#d5e8c4aa', 0.018);
    line(ctx, [[x + 0.09, y + 0.085], [x + w + 0.05, y + 0.085]], '#d5e8c46a', 0.015);
  }
  for (const [x, y] of [[-1.35, 0.32], [-1.29, 0.45], [1.12, -0.46], [1.22, -0.39], [0.63, 0.73]]) {
    line(ctx, [[x - 0.055, y - 0.16], [x, y], [x + 0.05, y - 0.20]], '#677d48', 0.027);
  }
  ctx.restore();
}

function depot(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  rounded(ctx, -0.79, -0.19, 1.58, 0.53, 0.07, '#aab582');
  rounded(ctx, -0.77, 0.28, 1.54, 0.12, 0.025, '#cab38c');
  for (let i = 0; i < 14; i += 1) {
    const p = -0.73 + i * 0.107;
    line(ctx, [[p, 0.30], [p, 0.38]], '#9e845f', 0.014);
  }
  rounded(ctx, -0.48, -0.27, 0.96, 0.48, 0.045, '#aa744c', '#754b33', 0.035);
  rounded(ctx, -0.55, -0.36, 1.10, 0.32, 0.06, '#8e513b', '#6c4835', 0.028);
  rounded(ctx, -0.52, -0.29, 1.04, 0.25, 0.035, '#b47150');
  line(ctx, [[-0.50, -0.20], [0.50, -0.20]], '#e2a480', 0.023);
  rounded(ctx, -0.065, -0.045, 0.13, 0.24, 0.015, '#6e543a');
  for (const sx of [-0.34, 0.22]) rounded(ctx, sx, 0.015, 0.12, 0.10, 0.01, '#f2d59b', '#7f5639');
  ctx.restore();
}

export const BACKGROUNDS = {plain: 'Grass', meadow: 'Meadow', coast: 'Coast', mountain: 'Mountains', desert: 'Desert'};

function polygon(ctx, points, color) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function coast(ctx, rand) {
  const water = ctx.createLinearGradient(0, 0, 5, 2);
  water.addColorStop(0, '#67a5b0');
  water.addColorStop(1, '#8cc6b6');
  const shore = y => 2.65 + 0.65 * Math.sin(y * 0.65) + 0.22 * Math.cos(y * 1.4);
  const edge = Array.from({length: 49}, (_, i) => [shore(i / 4), i / 4]);
  polygon(ctx, [[0, 0], ...edge.map(([x, y]) => [x + 0.9, y]), [0, SCENE_ROWS]], '#efd5a0');
  polygon(ctx, [[0, 0], ...edge, [0, SCENE_ROWS]], water);
  line(ctx, edge, '#fff3d7', 0.09);
  line(ctx, edge.map(([x, y]) => [x - 0.26, y]), '#c2e2d1a0', 0.045);
  for (let i = 0; i < 85; i += 1) {
    const y = rand() * SCENE_ROWS;
    const x = rand() * (shore(y) - 0.35);
    line(ctx, [[x, y], [x + 0.10, y - 0.025], [x + 0.25, y]], '#e2f0d777', 0.023);
  }
  for (const [x, y] of [[2.8, 1.2], [3.6, 4.6], [2.8, 8.3], [3.3, 10.9]]) {
    oval(ctx, x, y, 0.16, 0.09, '#a89977');
    oval(ctx, x - 0.09, y - 0.08, 0.095, 0.064, '#c3b28b');
  }
  ctx.save();
  ctx.translate(1.48, 8.0);
  ctx.rotate(-0.35);
  oval(ctx, 0.08, 0.10, 0.33, 0.14, '#42777b66');
  polygon(ctx, [[-0.35, 0.08], [0.34, 0.08], [0.21, 0.21], [-0.23, 0.21]], '#ad6550');
  polygon(ctx, [[-0.04, -0.42], [0.24, 0.04], [-0.04, 0.04]], '#fff2d1');
  polygon(ctx, [[-0.09, -0.29], [-0.09, 0.04], [-0.26, 0.04]], '#f1c476');
  ctx.restore();
  oval(ctx, 2.95, 10.2, 0.36, 0.26, '#b5ab82');
  rounded(ctx, 2.79, 9.62, 0.32, 0.64, 0.05, '#fff2d6', '#9f765d');
  rounded(ctx, 2.78, 9.89, 0.34, 0.13, 0.02, '#c7644f');
  polygon(ctx, [[2.72, 9.68], [2.95, 9.46], [3.18, 9.68]], '#ab533e');
}

function mountains(ctx, rand) {
  for (const [x, y, size] of [[0.5, 2.7, 2.4], [3.0, 1.4, 2.4], [5.9, 1.75, 2.9], [8.0, 1.15, 2.1], [10.7, 1.85, 3.0], [14.2, 2.15, 3.2], [16.0, 3.45, 2.45]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size, size);
    oval(ctx, 0.15, 0.35, 0.86, 0.28, '#526c6960');
    polygon(ctx, [[-0.86, 0.44], [-0.24, -0.26], [0, -0.63], [0.42, -0.08], [0.87, 0.39], [0.08, 0.52]], '#81908b');
    polygon(ctx, [[0, -0.63], [0.42, -0.08], [0.87, 0.39], [0.08, 0.52], [0.21, 0.02]], '#627874');
    polygon(ctx, [[-0.35, -0.12], [-0.24, -0.26], [0, -0.63], [0.35, -0.17], [0.15, -0.25], [0.08, -0.13], [-0.05, -0.31], [-0.16, -0.18]], '#e6e8db');
    ctx.restore();
  }
  for (let i = 0; i < 78; i += 1) {
    const x = rand() * COLS;
    const y = 3.3 + rand() * 8.4;
    if (x > 2.7 && x < 14 && y < 9.9 && rand() < 0.83) continue;
    pine(ctx, x, y, 0.57 + rand() * 0.7, ['#44655b', '#5a7a6b', '#729184']);
  }
  depot(ctx, 6.42, 8.48);
}

function desert(ctx, rand) {
  for (const [x, y, size] of [[1.1, 2.0, 1.6], [14.8, 1.3, 1.45], [15.2, 7.1, 1.5], [2.0, 10.1, 1.8], [11.4, 6.4, 1.35]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size, size);
    oval(ctx, 0.13, 0.21, 0.72, 0.37, '#ba825b5d');
    polygon(ctx, [[-0.7, 0.29], [-0.43, -0.25], [0.36, -0.28], [0.68, 0.33], [0.18, 0.45]], '#b87552');
    polygon(ctx, [[-0.7, 0.29], [-0.43, -0.25], [0.36, -0.28], [0.46, -0.06], [-0.38, 0.03]], '#d49165');
    line(ctx, [[-0.58, 0.17], [-0.32, 0.13], [0.49, 0.12]], '#edaf7f', 0.037);
    ctx.restore();
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < 31; i += 1) {
    const x = rand() * COLS;
    const y = rand() * SCENE_ROWS;
    oval(ctx, x + 0.08, y, 0.17, 0.065, '#b1935d5d');
    line(ctx, [[x, y], [x, y - 0.32]], '#66845d', 0.085);
    line(ctx, [[x - 0.13, y - 0.24], [x - 0.13, y - 0.12], [x + 0.13, y - 0.12], [x + 0.13, y - 0.28]], '#66845d', 0.055);
  }
}

export function drawGround(ctx, background, cols = COLS, rows = ROWS) {
  ctx.save();
  ctx.scale(cols / COLS, rows / SCENE_ROWS);
  const theme = background === true ? 'meadow' : background;
  const rand = randomSource(4737);
  const grass = ctx.createLinearGradient(0, 0, COLS, SCENE_ROWS);
  const [light, middle, dark] = {
    coast: ['#e5dfa8', '#d6d8a1', '#baca94'],
    mountain: ['#b5c3b7', '#c3ceac', '#a5bb9e'],
    desert: ['#edd3a3', '#e9c791', '#dcad7d'],
  }[theme] ?? ['#d6dfa9', '#cfdda6', '#bacb95'];
  grass.addColorStop(0, light);
  grass.addColorStop(0.55, middle);
  grass.addColorStop(1, dark);
  ctx.fillStyle = grass;
  ctx.fillRect(0, 0, COLS, SCENE_ROWS);
  for (let i = 0; i < 125; i += 1) {
    const x = rand() * COLS;
    const y = rand() * SCENE_ROWS;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 0.35 + rand() * 1.8);
    glow.addColorStop(0, i % 3 === 0 ? '#f2e8af50' : '#78975e34');
    glow.addColorStop(1, '#9bab6f00');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 2.2, y - 2.2, 4.4, 4.4);
  }
  for (let i = 0; i < 1050; i += 1) {
    const x = rand() * COLS;
    const y = rand() * SCENE_ROWS;
    oval(ctx, x, y, 0.008 + rand() * 0.019, 0.008 + rand() * 0.017, i % 4 === 0 ? '#ffface65' : '#617c4640');
  }
  if (theme === 'coast') coast(ctx, rand);
  if (theme === 'mountain') mountains(ctx, rand);
  if (theme === 'desert') desert(ctx, rand);
  if (theme === 'meadow') {
    for (let i = 0; i < 125; i += 1) {
      const x = rand() * COLS;
      const y = rand() * SCENE_ROWS;
      if (x > 2.75 && x < 14.25 && y > 1.55 && y < 10.15 && rand() < 0.78) continue;
      line(ctx, [[x - 0.065, y - 0.055], [x, y], [x + 0.045, y - 0.085]], '#78975588', 0.021);
      if (i % 5 === 0) {
        oval(ctx, x - 0.05, y - 0.05, 0.032, 0.027, '#f0df87');
        oval(ctx, x + 0.11, y + 0.025, 0.021, 0.022, '#fff2bd');
      }
    }
    pond(ctx);
    depot(ctx, 6.42, 8.48);
    const woods = [
      [0.65, 1.13, 1.31], [1.21, 0.87, 0.94], [1.18, 1.60, 1.05], [1.70, 1.31, 0.82], [2.18, 0.83, 0.73],
      [0.77, 3.48, 0.93], [1.56, 3.78, 0.75], [1.00, 4.00, 1.12], [1.74, 5.63, 1.13], [0.95, 5.85, 0.80],
      [1.06, 8.46, 0.80], [1.52, 8.92, 1.14], [0.88, 9.11, 0.95], [2.31, 10.44, 0.81], [1.70, 10.63, 1.10], [0.92, 10.94, 1.29], [1.48, 11.24, 0.89],
      [4.76, 5.51, 0.71], [5.36, 5.77, 0.90], [4.86, 6.10, 1.09], [5.51, 6.32, 0.61], [7.09, 6.93, 0.77],
      [11.64, 6.32, 0.75], [12.06, 6.70, 1.02], [12.33, 7.17, 0.75],
      [14.78, 1.17, 0.85], [15.60, 0.98, 1.17], [16.12, 1.34, 0.94], [15.35, 1.61, 1.12], [16.20, 2.16, 0.72],
      [15.04, 4.43, 1.0], [15.63, 4.19, 0.77], [16.21, 4.71, 0.91],
      [15.86, 7.07, 0.87], [16.29, 7.65, 1.14], [15.44, 7.80, 0.70],
      [14.83, 10.01, 1.18], [15.46, 9.85, 0.80], [16.21, 10.31, 1.31], [15.37, 10.68, 1.05], [15.95, 11.08, 0.91],
      [5.34, 11.15, 0.77], [5.94, 10.95, 1.0], [6.45, 11.31, 0.84], [10.44, 10.79, 0.82], [11.01, 11.09, 1.0],
    ];
    const shades = [['#557844', '#6d8d50', '#83a05c'], ['#617e49', '#779754', '#91a962'], ['#4b7047', '#608656', '#76a065']];
    woods.sort((a, b) => a[1] - b[1]).forEach(([x, y, size], i) => pine(ctx, x, y, size, shades[i % shades.length]));
  }
  ctx.restore();
  for (let x = 1; x < cols; x += 1) line(ctx, [[x, 0], [x, rows]], '#516a4137', 0.016);
  for (let y = 1; y < rows; y += 1) line(ctx, [[0, y], [cols, y]], '#516a4137', 0.016);
}

function offsetPoint(path, fraction, offset) {
  const [x, y, angle] = pointOn(path, fraction);
  return [x - Math.sin(angle) * offset, y + Math.cos(angle) * offset];
}

function rail(ctx, path, offset, color, width) {
  const steps = path.turn ? 16 : 1;
  const points = Array.from({length: steps + 1}, (_, i) => offsetPoint(path, i / steps, offset));
  line(ctx, points, color, width);
}

const tunnelHalfLength = 0.40;
const tunnelHalfWidth = 0.27;
// Overlap joined segments slightly so canvas antialiasing cannot leave a hairline gap.
const joinedHalfLength = 0.515;

function structureJoins(grid, x, y, cols, tile) {
  if (!grid) return [false, false];
  const vertical = tile.turn % 2;
  return [-1, 1].map(step => {
    const nx = x + (vertical ? 0 : step);
    const ny = y + (vertical ? step : 0);
    if (nx < 0 || nx >= cols || ny < 0 || ny * cols >= grid.length) return false;
    const neighbor = grid[ny * cols + nx];
    return neighbor?.type === tile.type && neighbor.turn % 2 === vertical;
  });
}

export function drawTunnelRoof(ctx, tile, x, y, grid, cols) {
  const [joinStart, joinEnd] = structureJoins(grid, x, y, cols, tile);
  const start = joinStart ? -joinedHalfLength : -tunnelHalfLength;
  const end = joinEnd ? joinedHalfLength : tunnelHalfLength;
  ctx.save();
  ctx.translate(x + 0.5, y + 0.5);
  ctx.rotate((tile.turn % 2) * Math.PI / 2);
  ctx.fillStyle = '#758277';
  ctx.fillRect(start, -tunnelHalfWidth, end - start, 2 * tunnelHalfWidth);
  const ridgeStart = joinStart ? start : -0.38;
  const ridgeEnd = joinEnd ? end : 0.38;
  polygon(ctx, [[ridgeStart, joinStart ? -0.34 : -0.23], [-0.24, -0.41], [0.05, -0.46],
    [0.27, -0.37], [ridgeEnd, joinEnd ? -0.34 : -0.23], [ridgeEnd, joinEnd ? 0.34 : 0.23],
    [0.22, 0.41], [-0.08, 0.46], [-0.28, 0.36], [ridgeStart, joinStart ? 0.34 : 0.23]], '#758277');
  polygon(ctx, [[-0.29, -0.22], [-0.21, -0.36], [0.04, -0.41], [0.24, -0.32], [0.29, -0.18],
    [0.22, 0.17], [-0.07, 0.29], [-0.25, 0.17]], '#929d83');
  line(ctx, [[-0.19, -0.10], [-0.06, -0.19], [0.15, -0.12]], '#aab297', 0.025);
  const portals = [joinStart ? null : start, joinEnd ? null : end];
  for (const edge of portals) {
    if (edge === null) continue;
    const face = edge - Math.sign(edge) * 0.035;
    line(ctx, [[face, -0.26], [face, 0.26]], '#4e5955', 0.07);
    for (const y of [-0.17, -0.04, 0.09, 0.21]) {
      line(ctx, [[face - 0.026, y], [face + 0.026, y]], '#89918a', 0.012);
    }
  }
  ctx.restore();
}

export function underTunnelRoof(grid, x, y, cols) {
  const col = Math.floor(x);
  const row = Math.floor(y);
  if (col < 0 || col >= cols || row < 0) return false;
  const tile = grid[row * cols + col];
  if (tile?.type !== 'tunnel') return false;
  const vertical = tile.turn % 2;
  const along = vertical ? y - row - 0.5 : x - col - 0.5;
  const across = vertical ? x - col - 0.5 : y - row - 0.5;
  if (Math.abs(across) > tunnelHalfWidth) return false;
  if (Math.abs(along) <= tunnelHalfLength) return true;
  const joins = structureJoins(grid, col, row, cols, tile);
  return joins[along < 0 ? 0 : 1];
}

function trackScenery(ctx, tile, foreground, joins) {
  if (tile.type !== 'station' && tile.type !== 'bridge') return;
  ctx.save();
  ctx.translate(0.5, 0.5);
  const turn = tile.type === 'bridge' ? tile.turn % 2 : tile.turn;
  ctx.rotate(turn * Math.PI / 2);
  if (tile.type === 'station' && !foreground) {
    rounded(ctx, -0.46, 0.19, 0.92, 0.26, 0.045, '#e6c88b', '#806340');
    line(ctx, [[-0.42, 0.237], [0.42, 0.237]], '#fff1ba', 0.036);
    rounded(ctx, -0.18, 0.28, 0.36, 0.18, 0.037, '#3e6b58', '#2c5148');
    line(ctx, [[-0.14, 0.325], [0.14, 0.325]], '#a3c6a9', 0.024);
    oval(ctx, 0.29, 0.35, 0.055, 0.055, '#eab652');
  }
  if (tile.type === 'bridge') {
    const [joinStart, joinEnd] = joins;
    if (foreground) {
      for (const y of [-0.245, 0.245]) {
        const rail = y * 1.43;
        line(ctx, [[joinStart ? -joinedHalfLength : -0.48, joinStart ? rail : y],
          [-0.26, rail], [0.26, rail], [joinEnd ? joinedHalfLength : 0.48, joinEnd ? rail : y]], '#8b3329', 0.055);
        for (const x of [-0.27, 0, 0.27]) line(ctx, [[x, y], [x + 0.07, y * 1.35]], '#bc5541', 0.037);
      }
    } else {
      const start = joinStart ? -joinedHalfLength : -0.49;
      const end = joinEnd ? joinedHalfLength : 0.49;
      const outerStartRadius = joinStart ? 0 : 0.045;
      const outerEndRadius = joinEnd ? 0 : 0.045;
      rounded(ctx, start, -0.32, end - start, 0.64,
        [outerStartRadius, outerEndRadius, outerEndRadius, outerStartRadius], '#703e34');
      const deckStart = joinStart ? start : -0.47;
      const deckEnd = joinEnd ? end : 0.47;
      const deckStartRadius = joinStart ? 0 : 0.025;
      const deckEndRadius = joinEnd ? 0 : 0.025;
      rounded(ctx, deckStart, -0.24, deckEnd - deckStart, 0.48,
        [deckStartRadius, deckEndRadius, deckEndRadius, deckStartRadius], '#c38863');
    }
  }
  ctx.restore();
}

export function drawTile(ctx, tile, x = 0, y = 0, grid, cols) {
  ctx.save();
  ctx.translate(x, y);
  const paths = trackPaths(tile, true).map(([from, to]) => segment(0, from, to));
  const joins = tile.type === 'bridge' ? structureJoins(grid, x, y, cols, tile) : null;
  trackScenery(ctx, tile, false, joins);
  if (isSwitch(tile) && !tile.branch) paths.reverse();
  for (const path of paths) rail(ctx, path, 0, '#ad956e', 0.42);
  for (const path of paths) {
    const count = Math.round(path.length * 7);
    for (let i = 0; i < count; i += 1) {
      const fraction = (i + 0.5) / count;
      line(ctx, [offsetPoint(path, fraction, -0.195), offsetPoint(path, fraction, 0.195)], '#79583d', 0.063);
      line(ctx, [offsetPoint(path, fraction, -0.173), offsetPoint(path, fraction, 0.17)], '#a77d55', 0.026);
    }
  }
  paths.forEach((path, i) => {
    const inactive = isSwitch(tile) && i === 0;
    for (const offset of [-0.106, 0.106]) {
      rail(ctx, path, offset, inactive ? '#594d3b' : '#413e32', 0.051);
      rail(ctx, path, offset - 0.008, inactive ? '#b1a38c' : '#e6dfc2', 0.020);
    }
    if (path.to === -1) {
      line(ctx, [offsetPoint(path, 0.98, -0.17), offsetPoint(path, 0.98, 0.17)], '#523e30', 0.10);
      line(ctx, [offsetPoint(path, 0.95, -0.145), offsetPoint(path, 0.95, 0.145)], '#c46543', 0.048);
    }
  });
  if (isSwitch(tile)) {
    const path = paths[1];
    const [x, y] = offsetPoint(path, 0.43, -0.27);
    oval(ctx, x, y, 0.065, 0.065, '#584a36');
    oval(ctx, x, y, 0.042, 0.042, '#f2bb58');
  }
  trackScenery(ctx, tile, true, joins);
  ctx.restore();
}

const steamStackOffset = 0.148;

export function steamPuff(car) {
  const dx = Math.cos(car.angle);
  const dy = Math.sin(car.angle);
  return {x: car.x + steamStackOffset * dx, y: car.y + steamStackOffset * dy, dx, dy};
}

export function drawSteamPuff(ctx, puff, age) {
  const x = puff.x - 0.28 * age * puff.dx + puff.drift * age;
  const y = puff.y - (0.20 + 0.28 * puff.dy) * age;
  const radius = 0.036 + 0.092 * age;
  ctx.save();
  ctx.globalAlpha = Math.min(1, 0.50 + 5 * age) * (1 - age) ** 1.5;
  oval(ctx, x, y + 0.02, radius * 1.15, radius * 0.83, '#69726d');
  oval(ctx, x - radius * 0.46, y, radius * 0.70, radius * 0.65, '#e2e7dc');
  oval(ctx, x + radius * 0.14, y - radius * 0.36, radius * 0.82, radius * 0.74, '#f6f5e8');
  oval(ctx, x + radius * 0.58, y + radius * 0.02, radius * 0.58, radius * 0.55, '#eef1e7');
  ctx.restore();
}

export function drawCar(ctx, car, x, y, angle = 0, boomAngle = 0) {
  const color = COLORS[car.color][1];
  const edge = '#3c3930';
  const metal = '#343833';
  const glass = '#d3e4dc';
  const shine = '#fff9dd8c';
  const shape = (x, y, w, h, r, fill = color) => rounded(ctx, x, y, w, h, r, fill, edge);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  oval(ctx, 0.015, 0.068, 0.338, 0.175, '#29392e55');
  rounded(ctx, -0.350, -0.032, 0.70, 0.064, 0.023, metal);
  for (const wx of [-0.215, 0.215]) {
    for (const wy of [-0.145, 0.105]) rounded(ctx, wx - 0.055, wy, 0.11, 0.07, 0.023, metal);
  }
  shape(-0.315, -0.133, 0.63, 0.266, 0.044, metal);
  switch (car.type) {
    case 'steam':
      shape(-0.295, -0.145, 0.244, 0.29, 0.039);
      shape(-0.10, -0.112, 0.38, 0.224, 0.093);
      line(ctx, [[-0.065, -0.060], [0.18, -0.06]], shine, 0.02);
      oval(ctx, steamStackOffset, 0, 0.078, 0.075, edge);
      oval(ctx, steamStackOffset, 0, 0.046, 0.043, '#71685b');
      oval(ctx, -0.021, 0, 0.036, 0.036, '#d5b368');
      line(ctx, [[-0.26, -0.095], [-0.12, -0.095]], glass, 0.025);
      line(ctx, [[-0.26, 0.095], [-0.12, 0.095]], glass, 0.025);
      shape(0.266, -0.109, 0.058, 0.218, 0.021, '#d3a44f');
      break;
    case 'diesel':
      shape(-0.296, -0.125, 0.57, 0.25, 0.047);
      shape(0.033, -0.15, 0.248, 0.30, 0.044);
      line(ctx, [[0.21, -0.098], [0.245, -0.035], [0.245, 0.035], [0.21, 0.098]], glass, 0.031);
      for (const x of [-0.24, -0.18, -0.12, -0.06]) line(ctx, [[x, -0.054], [x, 0.054]], edge, 0.018);
      line(ctx, [[-0.26, 0.087], [0.16, 0.087]], shine, 0.018);
      oval(ctx, 0.294, 0, 0.021, 0.034, '#ffde90');
      break;
    case 'electric':
      shape(-0.31, -0.145, 0.62, 0.29, 0.085);
      line(ctx, [[0.202, -0.109], [0.265, -0.070], [0.265, 0.070], [0.202, 0.109]], glass, 0.034);
      line(ctx, [[-0.202, -0.109], [-0.255, -0.070], [-0.255, 0.070], [-0.202, 0.109]], glass, 0.023);
      line(ctx, [[-0.16, 0.097], [0.168, 0.097]], shine, 0.026);
      line(ctx, [[-0.10, 0], [0, -0.072], [0.10, 0], [0, 0.072], [-0.10, 0]], edge, 0.033);
      line(ctx, [[-0.026, -0.083], [0.026, -0.083]], shine, 0.024);
      break;
    case 'box':
      shape(-0.307, -0.151, 0.614, 0.302, 0.029);
      for (let i = -4; i <= 4; i += 1) {
        line(ctx, [[i * 0.06, -0.131], [i * 0.06, 0.131]], '#3c393055', 0.016);
      }
      line(ctx, [[-0.28, -0.112], [0.28, -0.112]], shine, 0.023);
      line(ctx, [[-0.065, 0.095], [0.065, 0.095]], '#fff4ce', 0.026);
      break;
    case 'tank':
      shape(-0.296, -0.139, 0.592, 0.278, 0.132);
      for (const x of [-0.18, 0.18]) line(ctx, [[x, -0.121], [x, 0.121]], edge, 0.029);
      line(ctx, [[-0.126, -0.085], [0.122, -0.085]], shine, 0.024);
      oval(ctx, 0, 0.012, 0.073, 0.073, edge);
      oval(ctx, 0, 0.012, 0.052, 0.052, color);
      break;
    case 'flat':
      shape(-0.307, -0.147, 0.614, 0.294, 0.025);
      for (let i = -4; i <= 4; i += 1) {
        line(ctx, [[i * 0.064, -0.126], [i * 0.064, 0.126]], '#3c393064', 0.016);
      }
      for (const y of [-0.107, 0.107]) line(ctx, [[-0.27, y], [0.27, y]], shine, 0.017);
      break;
    case 'hopper':
      shape(-0.305, -0.151, 0.61, 0.302, 0.047);
      shape(-0.255, -0.104, 0.51, 0.208, 0.033, '#625b4b');
      for (const [x, y] of [[-0.19, 0.01], [-0.095, -0.044], [0.02, 0.039], [0.11, -0.031], [0.17, 0.047]]) {
        oval(ctx, x, y, 0.033, 0.026, '#a99c79');
      }
      line(ctx, [[-0.26, -0.124], [0.26, -0.124]], shine, 0.017);
      break;
    case 'caboose':
      shape(-0.305, -0.125, 0.61, 0.25, 0.026);
      shape(-0.246, -0.150, 0.49, 0.30, 0.032);
      shape(-0.185, -0.116, 0.21, 0.232, 0.035);
      for (const y of [-0.083, 0.083]) {
        line(ctx, [[-0.15, y], [-0.025, y]], glass, 0.027);
        line(ctx, [[0.105, y], [0.181, y]], '#f4d78d', 0.022);
      }
      oval(ctx, -0.290, -0.071, 0.019, 0.019, '#ffd376');
      oval(ctx, -0.290, 0.071, 0.019, 0.019, '#ffd376');
      break;
    case 'passenger':
      shape(-0.312, -0.152, 0.624, 0.304, 0.07);
      for (const y of [-0.109, 0.055]) {
        for (let i = 0; i < 5; i += 1) {
          const x = -0.245 + i * 0.107;
          rounded(ctx, x, y, 0.071, 0.054, 0.015, glass);
          if (i !== 2) oval(ctx, x + 0.041, y + 0.029, 0.016, 0.015, i % 2 ? '#ba7856' : '#684f43');
        }
      }
      line(ctx, [[-0.25, 0], [0.25, 0]], shine, 0.023);
      break;
    case 'log':
      shape(-0.31, -0.151, 0.62, 0.302, 0.033);
      for (const y of [-0.077, 0, 0.077]) {
        rounded(ctx, -0.264, y - 0.038, 0.51, 0.076, 0.032, '#8c5232', '#593c2b');
        line(ctx, [[-0.225, y - 0.017], [0.19, y - 0.017]], '#b78558', 0.017);
        oval(ctx, 0.232, y, 0.025, 0.033, '#e2af76');
      }
      for (const x of [-0.17, 0.14]) line(ctx, [[x, -0.127], [x, 0.127]], '#4a4134', 0.028);
      break;
    case 'crane':
      shape(-0.31, -0.151, 0.62, 0.302, 0.036);
      oval(ctx, -0.09, 0, 0.132, 0.127, '#4b4941');
      ctx.save();
      ctx.translate(-0.09, 0);
      ctx.rotate(boomAngle);
      shape(-0.09, -0.10, 0.18, 0.20, 0.03, '#e8ac48');
      shape(0.028, -0.043, 0.31, 0.086, 0.021, '#e8ac48');
      for (const x of [0.09, 0.16, 0.23]) line(ctx, [[x, 0.028], [x + 0.045, -0.028]], '#785029', 0.018);
      line(ctx, [[0.327, 0.013], [0.36, 0.066], [0.325, 0.097]], '#4a4134', 0.024);
      ctx.restore();
      break;
    case 'snowplow':
      shape(-0.30, -0.143, 0.52, 0.286, 0.05);
      shape(-0.115, -0.133, 0.21, 0.266, 0.04);
      line(ctx, [[0.057, -0.087], [0.057, 0.087]], glass, 0.035);
      polygon(ctx, [[0.13, -0.17], [0.22, -0.164], [0.37, 0], [0.22, 0.164], [0.13, 0.17]], '#e7b54f');
      line(ctx, [[0.20, -0.155], [0.37, 0], [0.20, 0.155]], '#594630', 0.031);
      line(ctx, [[0.235, -0.097], [0.283, -0.054], [0.24, -0.036]], '#fbdf96', 0.022);
      break;
    case 'tender':
      shape(-0.304, -0.154, 0.608, 0.308, 0.04);
      shape(-0.245, -0.111, 0.34, 0.222, 0.033, '#333733');
      for (const [x, y] of [[-0.21,-0.045],[-0.14,0.041],[-0.09,-0.055],[-0.035,0.026],[0.035,-0.039]]) {
        polygon(ctx, [[x - 0.035, y + 0.018], [x - 0.008, y - 0.025], [x + 0.038, y - 0.013], [x + 0.027, y + 0.03]], '#686761');
      }
      oval(ctx, 0.182, 0, 0.054, 0.058, '#d1bd86');
      line(ctx, [[-0.25, -0.128], [0.23, -0.128]], shine, 0.018);
      break;
  }
  ctx.restore();
}
