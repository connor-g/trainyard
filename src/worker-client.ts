/** The page's side of the yard worker: sends messages, and pairs requests with their replies. */
import type { FromWorker, Request, RequestType, Requests, ToWorker } from "./engine/protocol.ts";

/** What the page needs of a `Worker`, so tests can stand in for one. */
export interface WorkerPort {
  postMessage(message: ToWorker, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** Messages the worker sends without being asked. */
export type WorkerEvent = Exclude<FromWorker, { type: "reply" | "failed" }>;

export class WorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerError";
  }
}

/** The page's handle on the worker. */
export interface WorkerClient {
  readonly send: (message: ToWorker, transfer?: Transferable[]) => void;
  /** Sends a request to the worker and resolves with its reply, or rejects if it failed. */
  readonly request: <T extends RequestType>(
    type: T,
    message: Requests[T]["message"],
  ) => Promise<Requests[T]["reply"]>;
}

export function connectWorker(
  port: WorkerPort,
  onEvent: (event: WorkerEvent) => void,
): WorkerClient {
  const pending = new Map<
    number,
    { resolve: (value: never) => void; reject: (error: Error) => void }
  >();
  let lastRequest = 0;

  port.onmessage = ({ data }) => {
    if (data.type !== "reply" && data.type !== "failed") return onEvent(data);
    const awaited = pending.get(data.id);
    pending.delete(data.id);
    if (data.type === "reply") awaited?.resolve(data.value as never);
    else awaited?.reject(new WorkerError(data.error));
  };
  // An uncaught error may have lost any reply, so nothing still waiting can count on one.
  port.onerror = (event) => {
    const error = new WorkerError(event.message || "The yard worker failed");
    for (const awaited of pending.values()) awaited.reject(error);
    pending.clear();
  };

  const send = (message: ToWorker, transfer: Transferable[] = []) =>
    port.postMessage(message, transfer);

  /** Sends a request to the worker and resolves with its reply, or rejects if it failed. */
  function request<T extends RequestType>(
    type: T,
    message: Requests[T]["message"],
  ): Promise<Requests[T]["reply"]> {
    const id = (lastRequest += 1);
    const { promise, resolve, reject } = Promise.withResolvers<Requests[T]["reply"]>();
    pending.set(id, { resolve, reject });
    send({ ...message, type, id } as Request);
    return promise;
  }

  return { send, request };
}
