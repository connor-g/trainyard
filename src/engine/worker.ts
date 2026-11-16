/** The yard worker: runs the engine and draws on the board canvas the page hands over. */
import { createEngine } from "./engine.ts";
import type { Engine } from "./engine.ts";
import { createRenderer } from "./renderer.ts";
import type { FromWorker, ToWorker } from "./protocol.ts";

// The project compiles against the DOM library, so describe the worker scope it uses here.
interface WorkerScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
  requestAnimationFrame(callback: (now: number) => void): number;
}
const scope = self as unknown as WorkerScope;

let engine: Engine | undefined;

function tick(now: number) {
  engine!.frame(now);
  scope.requestAnimationFrame(tick);
}

scope.onmessage = ({ data }) => {
  if (data.type === "init") {
    engine = createEngine(createRenderer(data.canvas), (message) => scope.postMessage(message));
    engine.start();
    scope.requestAnimationFrame(tick);
    return;
  }
  // The page sends init first, and messages arrive in order.
  engine!.handle(data);
};
