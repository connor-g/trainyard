import { describe, expect, test } from "vite-plus/test";
import type { FromWorker, ToWorker } from "../src/engine/protocol.ts";
import { WorkerError, connectWorker } from "../src/worker-client.ts";
import type { WorkerEvent, WorkerPort } from "../src/worker-client.ts";

function fakeWorker() {
  const sent: ToWorker[] = [];
  const port: WorkerPort = {
    postMessage: (message) => void sent.push(message),
    onmessage: null,
    onerror: null,
  };
  const events: WorkerEvent[] = [];
  const client = connectWorker(port, (event) => events.push(event));
  const receive = (data: FromWorker) => port.onmessage!({ data } as MessageEvent<FromWorker>);
  const lastId = () => (sent.at(-1) as { id: number }).id;
  return { port, sent, events, client, receive, lastId };
}

describe("worker client", () => {
  test("pairs each request with its reply", async () => {
    const { client, receive, lastId } = fakeWorker();
    const first = client.request("yard", {});
    const firstId = lastId();
    const second = client.request("edit", { edit: { type: "rename", name: "Home" } });
    receive({ type: "reply", id: lastId(), value: { ok: true } });
    receive({ type: "reply", id: firstId, value: "the yard" as never });
    expect(await second).toEqual({ ok: true });
    expect(await first).toBe("the yard");
  });

  test("rejects a request the worker failed to answer", async () => {
    const { client, receive, lastId } = fakeWorker();
    const picture = client.request("picture", { spec: { kind: "ground", background: "plain" } });
    receive({ type: "failed", id: lastId(), error: "no canvas" });
    await expect(picture).rejects.toEqual(new WorkerError("no canvas"));
  });

  test("rejects every waiting request when the worker crashes", async () => {
    const { client, port } = fakeWorker();
    const waiting = [client.request("yard", {}), client.request("builtIns", {})];
    port.onerror!({ message: "boom" } as ErrorEvent);
    for (const request of waiting) await expect(request).rejects.toBeInstanceOf(WorkerError);
  });

  test("passes on everything else the worker sends", () => {
    const { events, receive } = fakeWorker();
    receive({ type: "refused", reason: "needs-track" });
    receive({ type: "call", sound: "station" });
    expect(events).toEqual([
      { type: "refused", reason: "needs-track" },
      { type: "call", sound: "station" },
    ]);
  });
});
