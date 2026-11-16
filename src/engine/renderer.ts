/**
 * Draws the yard on the board canvas the page handed over, and the pictures the page shows
 * elsewhere. Four canvases in all, every one an OffscreenCanvas:
 *   screen:      the board as shown; each frame copies the scene and draws the trains, steam
 *                and tunnel roofs over it.
 *   groundLayer: the scenery, which is costly to paint; redrawn on resize or a new background.
 *   sceneLayer:  the ground plus track and any drag preview; redrawn when either changes.
 *   sketch:      palette pieces, background samples and yard thumbnails, one at a time.
 * Layers are marked stale and redrawn at most once per frame.
 */
import { COLS, ROWS, cellAt } from "../railway.ts";
import type { Board } from "../railway.ts";
import { initialMotion } from "../model/motion.ts";
import { carPositions, underTunnelRoof, visibleTile } from "../model/queries.ts";
import type { CarRef, TrainId, Yard } from "../model/types.ts";
import {
  drawCar,
  drawGround,
  drawSteamPuff,
  drawTile,
  drawTunnelRoof,
  steamPuff,
} from "../drawing.ts";
import type { SteamPuff } from "../drawing.ts";
import type { Frame, Renderer, Scene } from "./engine.ts";
import type { PictureSpec } from "./protocol.ts";

type Context = OffscreenCanvasRenderingContext2D;
type Puff = SteamPuff & { start: number; drift: number };

const puffLifetime = 760;
const craneSwingDuration = 950;
const carKey = (trainId: TrainId, carIndex: number) => trainId + ":" + carIndex;

/** Picture sizes in pixels; the page's CSS keeps their aspect ratios. */
const pictureSizes = {
  track: [144, 128],
  cars: [176, 120],
  ground: [216, 126],
  yard: [288, 168],
} as const;

function drawTiles(ctx: Context, board: Board, skip = -1) {
  for (const [index, tile] of board.grid.entries()) {
    if (tile && index !== skip)
      drawTile(ctx, visibleTile({ board }, index)!, ...cellAt(index, board.cols), board);
  }
}

function drawTunnelRoofs(ctx: Context, board: Board) {
  for (const [index, tile] of board.grid.entries()) {
    if (tile?.type === "tunnel") drawTunnelRoof(ctx, tile, ...cellAt(index, board.cols), board);
  }
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

function drawPicture(ctx: Context, spec: PictureSpec, width: number, height: number) {
  switch (spec.kind) {
    case "ground":
      ctx.scale(width / COLS, height / ROWS);
      return drawGround(ctx, spec.background, COLS, ROWS);
    case "yard":
      return drawYardThumbnail(ctx, spec.yard, width, height);
    case "piece": {
      const { piece } = spec;
      ctx.translate(width / 2, height / 2);
      if (piece.kind === "track") {
        ctx.scale(120, 120);
        drawTile(ctx, piece.tile, -0.5, -0.5);
        if (piece.tile.type === "tunnel") drawTunnelRoof(ctx, piece.tile, -0.5, -0.5);
      } else {
        ctx.scale(220, 220);
        drawCar(ctx, piece, 0, 0);
      }
    }
  }
}

export function createRenderer(screen: OffscreenCanvas): Renderer {
  const groundLayer = new OffscreenCanvas(1, 1);
  const sceneLayer = new OffscreenCanvas(1, 1);
  const sketch = new OffscreenCanvas(1, 1);
  // The ground paints every pixel, so the board layers can skip alpha blending with the page.
  const opaque = { alpha: false };
  const screenContext = screen.getContext("2d", opaque)!;
  const groundContext = groundLayer.getContext("2d", opaque)!;
  const sceneContext = sceneLayer.getContext("2d", opaque)!;
  const sketchContext = sketch.getContext("2d")!;
  let groundStale = true;
  let sceneStale = true;
  let frameStale = true;
  /** The board the scene layer last drew, which may be a drag preview; tunnel roofs follow it. */
  let sceneBoard: Board | null = null;
  let smokePuffs: Puff[] = [];
  /** When each steam engine last puffed, keyed by train and car index. */
  let lastPuff = new Map<string, number>();
  let activeCrane: (CarRef & { start: number }) | null = null;

  /** Scales a context so one unit is one grid square. */
  function toBoardUnits(ctx: Context, board: Board) {
    ctx.setTransform(ctx.canvas.width / board.cols, 0, 0, ctx.canvas.height / board.rows, 0, 0);
  }

  /** Copies a whole layer onto another of the same size, pixel for pixel. */
  function copyLayer(ctx: Context, layer: OffscreenCanvas) {
    ctx.resetTransform();
    ctx.drawImage(layer, 0, 0);
  }

  function drawScene({ board, highlight }: Scene) {
    const ctx = sceneContext;
    copyLayer(ctx, groundLayer);
    toBoardUnits(ctx, board);
    sceneBoard = board;
    drawTiles(ctx, board, highlight?.index);
    if (!highlight) return;
    const { column, row, index, valid, car } = highlight;
    ctx.fillStyle = valid ? "#fff2b883" : "#c7705959";
    ctx.fillRect(column, row, 1, 1);
    ctx.strokeStyle = valid ? "#935e2d" : "#9b4538";
    ctx.lineWidth = 0.05;
    ctx.strokeRect(column + 0.025, row + 0.025, 0.95, 0.95);
    if (board.grid[index]) drawTile(ctx, visibleTile({ board }, index)!, column, row, board);
    if (car) {
      ctx.globalAlpha = 0.73;
      drawCar(ctx, car, car.x, car.y, car.angle);
      ctx.globalAlpha = 1;
    }
  }

  /** Draws the trains and their steam, puffing more steam when `emitSmoke` is set. */
  function drawStock(ctx: Context, frame: Frame, now: number, emitSmoke: boolean) {
    const { yard, motion, movingTrains, speed } = frame;
    const positions = carPositions(yard, motion);
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

  const renderer: Renderer = {
    resize(width, height, scene, frame) {
      for (const canvas of [screen, groundLayer, sceneLayer]) {
        canvas.width = width;
        canvas.height = height;
      }
      renderer.groundChanged();
      // Resizing cleared the screen; draw before this task ends so no blank frame shows.
      renderer.render(scene, frame, performance.now(), false);
    },

    groundChanged() {
      groundStale = sceneStale = frameStale = true;
    },
    sceneChanged() {
      sceneStale = frameStale = true;
    },
    frameChanged() {
      frameStale = true;
    },

    get needsFrame() {
      return frameStale || Boolean(activeCrane) || smokePuffs.length > 0;
    },

    render(scene, frame, now, emitSmoke) {
      const { yard } = frame;
      if (groundStale) {
        toBoardUnits(groundContext, yard.board);
        drawGround(groundContext, yard.background, yard.board.cols, yard.board.rows);
        groundStale = false;
      }
      if (sceneStale || !sceneBoard) {
        drawScene(scene());
        sceneStale = false;
      }
      copyLayer(screenContext, sceneLayer);
      toBoardUnits(screenContext, yard.board);
      drawStock(screenContext, frame, now, emitSmoke);
      drawTunnelRoofs(screenContext, sceneBoard!);
      frameStale = false;
      if (activeCrane && now - activeCrane.start >= craneSwingDuration) activeCrane = null;
    },

    swingCrane(car, now) {
      activeCrane = { ...car, start: now };
    },

    resetEffects() {
      smokePuffs = [];
      lastPuff = new Map();
      activeCrane = null;
    },

    picture(spec) {
      const [width, height] = pictureSizes[spec.kind === "piece" ? spec.piece.kind : spec.kind];
      sketch.width = width;
      sketch.height = height;
      sketchContext.resetTransform();
      sketchContext.clearRect(0, 0, width, height);
      drawPicture(sketchContext, spec, width, height);
      // convertToBlob copies the bitmap right away, so the sketch is free for the next picture.
      return sketch.convertToBlob();
    },
  };
  return renderer;
}
