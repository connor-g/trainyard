import { describe, expect, test } from "vite-plus/test";
import { indexAt } from "../src/railway.ts";
import { createEngine } from "../src/engine/engine.ts";
import type { Renderer } from "../src/engine/engine.ts";
import type {
  BoardFraction,
  FromWorker,
  Request,
  Status,
  ToWorker,
} from "../src/engine/protocol.ts";

/** A request without its id, which the test assigns. */
type Ask = Request extends infer R ? (R extends Request ? Omit<R, "id"> : never) : never;

/** A renderer that draws nothing and counts what it was asked to redraw. */
function stubRenderer() {
  const calls = { ground: 0, scene: 0, render: 0, crane: 0 };
  const renderer: Renderer = {
    resize: () => {},
    groundChanged: () => void (calls.ground += 1),
    sceneChanged: () => void (calls.scene += 1),
    frameChanged: () => {},
    needsFrame: false,
    render: (scene) => {
      calls.render += 1;
      scene();
    },
    swingCrane: () => void (calls.crane += 1),
    resetEffects: () => {},
    picture: async () => new Blob(),
  };
  return { renderer, calls };
}

function setup() {
  const posted: FromWorker[] = [];
  const { renderer, calls } = stubRenderer();
  let now = 0;
  const engine = createEngine(
    renderer,
    (message) => posted.push(message),
    () => now,
  );
  engine.start();
  const status = () =>
    posted.findLast(
      (message): message is Extract<FromWorker, { type: "status" }> => message.type === "status",
    )!.status;
  const { cols, rows } = engine.yard.board;
  /** The middle of a square, as the page reports pointer positions. */
  const square = (column: number, row: number): BoardFraction => [
    (column + 0.5) / cols,
    (row + 0.5) / rows,
  ];
  let id = 0;
  const send = (message: ToWorker) => engine.handle(message);
  const ask = (message: Ask) => {
    send({ ...message, id: (id += 1) } as ToWorker);
    const reply = posted.findLast((m) => m.type === "reply" && m.id === id);
    return reply?.type === "reply" ? reply.value : undefined;
  };
  const tick = (seconds: number) => {
    for (let i = 0; i < seconds * 60; i += 1) engine.frame((now += 1000 / 60));
  };
  return { engine, posted, calls, status, square, send, ask, tick, cols };
}

describe("yard engine", () => {
  test("reports the starting yard", () => {
    const { status } = setup();
    expect(status()).toMatchObject<Partial<Status>>({
      name: "Meadow Loop",
      canUndo: false,
      resetFocus: true,
    });
  });

  test("a palette piece dropped on the board places track, and undo removes it", () => {
    const { engine, status, square, send, ask } = setup();
    expect(ask({ type: "grab", from: { kind: "track", type: "straight" } })).toEqual({
      kind: "track",
      tile: { type: "straight", turn: 0, branch: false },
    });
    send({ type: "drag", at: square(0, 0) });
    send({ type: "release", at: square(0, 0), remove: false });
    expect(engine.yard.board.grid[0]).toMatchObject({ type: "straight" });
    expect(status().canUndo).toBe(true);
    send({ type: "undo" });
    expect(engine.yard.board.grid[0]).toBeNull();
  });

  test("a car dropped on grass is refused with a reason", () => {
    const { posted, square, send, ask } = setup();
    ask({ type: "grab", from: { kind: "cars", type: "steam", color: "brick" } });
    send({ type: "drag", at: square(0, 0) });
    send({ type: "release", at: square(0, 0), remove: false });
    expect(posted).toContainEqual({ type: "refused", reason: "needs-track" });
  });

  test("tapping track turns it; dragging it to the remove zone removes it", () => {
    const { engine, square, send, ask } = setup();
    ask({ type: "edit", edit: { type: "placeTrack", at: 0, track: "curve" } });
    expect(ask({ type: "grab", from: square(0, 0) })).toMatchObject({ kind: "track" });
    send({ type: "release", at: square(0, 0), remove: false });
    expect(engine.yard.board.grid[0]!.turn).toBe(1);

    ask({ type: "grab", from: square(0, 0) });
    send({ type: "drag", at: null });
    send({ type: "release", at: null, remove: true });
    expect(engine.yard.board.grid[0]).toBeNull();
  });

  test("grabbing an empty square holds nothing to show", () => {
    const { square, ask } = setup();
    expect(ask({ type: "grab", from: square(0, 0) })).toBeNull();
  });

  test("trains wait while a piece is dragged, and roll again once it is dropped", () => {
    const { engine, posted, send, ask, tick } = setup();
    tick(0.5);
    expect(posted).toContainEqual({ type: "rolling", engines: ["steam"] });
    ask({ type: "grab", from: { kind: "track", type: "straight" } });
    send({ type: "drag", at: null });
    const held = engine.motion;
    tick(0.5);
    expect(engine.motion).toBe(held);
    expect(posted.at(-1)).toEqual({ type: "rolling", engines: [] });
    send({ type: "cancel" });
    tick(0.5);
    expect(engine.motion).not.toBe(held);
  });

  test("edit requests answer whether they applied", () => {
    const { engine, ask } = setup();
    expect(ask({ type: "edit", edit: { type: "rename", name: "Home" } })).toEqual({ ok: true });
    expect(engine.yard.name).toBe("Home");
    expect(ask({ type: "edit", edit: { type: "removeTrack", at: 0 } })).toMatchObject({
      ok: false,
    });
    expect(ask({ type: "yard" })).toBe(engine.yard);
  });

  test("the keyboard marks a square and can remove what is on it", () => {
    const { engine, calls, send, cols } = setup();
    const scenes = calls.scene;
    send({ type: "keyboard", square: [8, 2] });
    expect(calls.scene).toBe(scenes + 1);
    send({ type: "keyboard", square: [8, 2], action: "remove" });
    expect(engine.yard.board.grid[indexAt(8, 2, cols)]).toBeNull();
  });
});
