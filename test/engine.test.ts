import { describe, expect, test } from "vite-plus/test";

import type { Car } from "../src/catalog.ts";
import { createEngine } from "../src/engine/engine.ts";
import type { Renderer, Scene } from "../src/engine/engine.ts";
import type {
  BoardFraction,
  FromWorker,
  Request,
  Status,
  ToWorker,
} from "../src/engine/protocol.ts";
import { carPositions } from "../src/model/queries.ts";
import type { Yard } from "../src/model/types.ts";
import { indexAt } from "../src/railway.ts";
import { blankSaved, parseSaved, toSaved } from "../src/saves.ts";
import { addTrain, stateOf, yardWith } from "./helpers.ts";
import type { Piece } from "./helpers.ts";

/** A request without its id, which the test assigns. */
type Ask = Request extends infer R ? (R extends Request ? Omit<R, "id"> : never) : never;

const diesel: Car = { type: "diesel", color: "brick" };

/** A loop of track around the board's top left, with a diesel on it. */
function loopWithTrain(): Yard {
  const pieces: Piece[] = [
    [1, 1, "curve", 0],
    [2, 1, "straight", 0],
    [3, 1, "curve", 1],
    [3, 2, "curve", 2],
    [2, 2, "straight", 0],
    [1, 2, "curve", 3],
  ];
  return addTrain(stateOf(yardWith(pieces)), 2, 1, [diesel]).yard;
}

/** A renderer that draws nothing; it keeps the scene it was given so tests can look at it. */
function stubRenderer(picture: Renderer["picture"] = async () => new Blob()) {
  let scene: (() => Scene) | undefined;
  const renderer: Renderer = {
    resize: (_width, _height, current) => void (scene = current),
    groundChanged: () => {},
    sceneChanged: () => {},
    frameChanged: () => {},
    needsFrame: false,
    render: (current) => void (scene = current),
    swingCrane: () => {},
    resetEffects: () => {},
    picture,
  };
  return { renderer, scene: () => scene!() };
}

function setup({ initial, picture }: { initial?: Yard; picture?: Renderer["picture"] } = {}) {
  const posted: FromWorker[] = [];
  const { renderer, scene } = stubRenderer(picture);
  let now = 0;
  const engine = createEngine(renderer, (message) => posted.push(message), {
    ...(initial && { initial }),
    clock: () => now,
  });
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
  /** Sends a request and returns what the worker answered: a reply, or a failure. */
  const answer = (message: Ask) => {
    send({ ...message, id: (id += 1) } as ToWorker);
    return posted.findLast(
      (m): m is Extract<FromWorker, { type: "reply" | "failed" }> =>
        (m.type === "reply" || m.type === "failed") && m.id === id,
    );
  };
  const ask = (message: Ask) => {
    const reply = answer(message);
    return reply?.type === "reply" ? reply.value : undefined;
  };
  const tick = (seconds: number) => {
    for (let i = 0; i < seconds * 60; i += 1) engine.frame((now += 1000 / 60));
  };
  const cars = () => [...carPositions(engine.yard, engine.motion).values()].flat();
  send({ type: "resize", width: 100, height: 100 });
  return { engine, posted, scene, status, square, send, answer, ask, tick, cols, cars };
}

describe("yard engine", () => {
  test("starts with Meadow Loop", () => {
    const { status } = setup();
    expect(status()).toMatchObject<Partial<Status>>({
      name: "Meadow Loop",
      canUndo: false,
      resetFocus: true,
    });
  });

  test("a palette piece dropped on the board places track, and undo removes it", () => {
    const { engine, status, square, send, ask } = setup({ initial: yardWith([]) });
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
    const { posted, square, send, ask } = setup({ initial: yardWith([]) });
    ask({ type: "grab", from: { kind: "cars", type: "steam", color: "brick" } });
    send({ type: "drag", at: square(0, 0) });
    send({ type: "release", at: square(0, 0), remove: false });
    expect(posted).toContainEqual({ type: "refused", reason: "needs-track" });
  });

  test("tapping track turns it; dragging it to the remove zone removes it", () => {
    const { engine, square, send, ask } = setup({ initial: yardWith([[0, 0, "curve", 0]]) });
    expect(ask({ type: "grab", from: square(0, 0) })).toMatchObject({ kind: "track" });
    send({ type: "release", at: square(0, 0), remove: false });
    expect(engine.yard.board.grid[0]!.turn).not.toBe(0);

    ask({ type: "grab", from: square(0, 0) });
    send({ type: "drag", at: null });
    send({ type: "release", at: null, remove: true });
    expect(engine.yard.board.grid[0]).toBeNull();
  });

  test("grabbing an empty square holds nothing to show", () => {
    const { square, ask } = setup({ initial: yardWith([]) });
    expect(ask({ type: "grab", from: square(0, 0) })).toBeNull();
  });

  test("trains wait while a piece is dragged, and roll again once it is dropped", () => {
    const { posted, send, ask, tick, cars } = setup({ initial: loopWithTrain() });
    tick(0.5);
    expect(posted).toContainEqual({ type: "rolling", engines: ["diesel"] });
    ask({ type: "grab", from: { kind: "track", type: "straight" } });
    send({ type: "drag", at: null });
    const waiting = cars();
    const sent = posted.length;
    tick(0.5);
    expect(cars()).toEqual(waiting);
    expect(posted.slice(sent)).toContainEqual({ type: "rolling", engines: [] });
    send({ type: "cancel" });
    tick(0.5);
    expect(cars()).not.toEqual(waiting);
  });

  test("edit requests answer whether they applied, and report refusals like any edit", () => {
    const { engine, posted, ask } = setup({ initial: yardWith([]) });
    expect(ask({ type: "edit", edit: { type: "rename", name: "Home" } })).toEqual({ ok: true });
    expect(engine.yard.name).toBe("Home");
    expect(ask({ type: "edit", edit: { type: "removeTrack", at: 0 } })).toMatchObject({
      ok: false,
    });
    expect(posted).toContainEqual({ type: "refused", reason: "no-change" });
  });

  test("yards cross to the page in their saved shape, and load from it", () => {
    const { engine, ask } = setup();
    const saved = ask({ type: "yard" });
    expect(saved).toEqual(toSaved(engine.yard));
    expect(parseSaved(JSON.parse(JSON.stringify(saved)))).toEqual(saved);

    const builtIns = ask({ type: "builtIns" }) as ReturnType<typeof toSaved>[];
    expect(builtIns.map((yard) => yard.name)).toContain("Meadow Loop");
    const blank = blankSaved("Empty", { cols: 12, rows: 9 }, "desert");
    expect(ask({ type: "edit", edit: { type: "replace", yard: blank } })).toEqual({ ok: true });
    expect(toSaved(engine.yard)).toEqual(blank);
  });

  test("the keyboard marks a square and can remove what is on it", () => {
    const { engine, scene, send, cols } = setup({ initial: yardWith([[8, 2, "straight"]]) });
    send({ type: "keyboard", square: [8, 2] });
    expect(scene().highlight).toMatchObject({ column: 8, row: 2, valid: true });
    send({ type: "keyboard", square: [8, 2], action: "remove" });
    expect(engine.yard.board.grid[indexAt(8, 2, cols)]).toBeNull();
    send({ type: "keyboard", square: null });
    expect(scene().highlight).toBeNull();
  });

  test("a picture that fails to draw is answered with the failure", async () => {
    const { posted, send } = setup({
      picture: () => {
        throw new Error("no canvas");
      },
    });
    send({ type: "picture", id: 7, spec: { kind: "ground", background: "plain" } });
    await new Promise((resolve) => setTimeout(resolve));
    expect(posted).toContainEqual({ type: "failed", id: 7, error: "no canvas" });
  });
});
