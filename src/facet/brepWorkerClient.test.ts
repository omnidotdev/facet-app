import { describe, expect, test } from "bun:test";

import { BrepWorkerClient, SupersededError } from "@/facet/brepWorkerClient";
import { KernelError } from "@/facet/kernel";

import type {
  BrepRequest,
  BrepResponse,
  WorkerLike,
} from "@/facet/brepWorkerClient";
import type { Mesh } from "@/facet/kernel";
import type { OpNode } from "@/facet/opgraph";

/** A worker stand-in that records requests and answers only when told to */
class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<BrepResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  sent: BrepRequest[] = [];
  terminated = false;

  postMessage(message: BrepRequest): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  answer(response: BrepResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<BrepResponse>);
  }

  /** Answer the oldest request of a kind with a successful mesh */
  answerMesh(index: number, triangleCount: number): void {
    const request = this.sent[index];
    this.answer({ id: request.id, ok: true, mesh: meshOf(triangleCount) });
  }
}

const meshOf = (triangleCount: number): Mesh => ({
  positions: new Float32Array(9),
  normals: new Float32Array(9),
  triangleCount,
});

const cube = (size: number): OpNode =>
  ({ op: "cube", size: [size, size, size] }) as unknown as OpNode;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const setup = (timeoutMs?: number) => {
  const workers: FakeWorker[] = [];
  const client = new BrepWorkerClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  }, timeoutMs);
  return { client, workers };
};

describe("BrepWorkerClient", () => {
  test("resolves an evaluation with the worker's mesh", async () => {
    const { client, workers } = setup();
    const pending = client.evaluate(cube(1));
    expect(workers[0].sent).toHaveLength(1);
    workers[0].answerMesh(0, 12);
    expect((await pending).triangleCount).toBe(12);
  });

  test("coalesces rapid evaluations to the latest request", async () => {
    const { client, workers } = setup();
    const first = client.evaluate(cube(1));
    const second = client.evaluate(cube(2));
    const third = client.evaluate(cube(3));

    // Only the in-flight request reaches the worker; the middle one is dropped
    await expect(second).rejects.toBeInstanceOf(SupersededError);
    expect(workers[0].sent).toHaveLength(1);

    workers[0].answerMesh(0, 1);
    expect((await first).triangleCount).toBe(1);
    await flush();

    // The latest request starts once the worker is free
    expect(workers[0].sent).toHaveLength(2);
    expect(workers[0].sent[1]).toMatchObject({
      kind: "evaluate",
      node: cube(3),
    });
    workers[0].answerMesh(1, 3);
    expect((await third).triangleCount).toBe(3);
  });

  test("never coalesces exports", async () => {
    const { client, workers } = setup();
    const evaluation = client.evaluate(cube(1));
    const stl = client.export(cube(1), "stl");
    const step = client.export(cube(1), "step");
    expect(workers[0].sent.map((r) => r.kind)).toEqual([
      "evaluate",
      "export",
      "export",
    ]);
    const bytes = new Uint8Array([1, 2, 3]);
    workers[0].answerMesh(0, 1);
    workers[0].answer({ id: workers[0].sent[1].id, ok: true, data: bytes });
    workers[0].answer({ id: workers[0].sent[2].id, ok: true, data: bytes });
    await evaluation;
    expect(await stl).toEqual(bytes);
    expect(await step).toEqual(bytes);
  });

  test("shows a user-facing kernel message verbatim", async () => {
    const { client, workers } = setup();
    const pending = client.evaluate(cube(1));
    workers[0].answer({
      id: workers[0].sent[0].id,
      ok: false,
      error: "Fillet radius is too large for this edge.",
      userFacing: true,
    });
    const error = await pending.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(KernelError);
    expect((error as Error).message).toBe(
      "Fillet radius is too large for this edge.",
    );
  });

  test("hides an internal failure behind a generic message", async () => {
    const { client, workers } = setup();
    const pending = client.export(cube(1), "step");
    workers[0].answer({
      id: workers[0].sent[0].id,
      ok: false,
      error: "Standard_ConstructionError at 0x1f2e",
      userFacing: false,
    });
    const error = await pending.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(KernelError);
    expect((error as Error).message).not.toContain("Standard_");
  });

  test("replaces a stuck worker and fails what was in flight", async () => {
    const { client, workers } = setup(20);
    const stuck = client.evaluate(cube(1));
    const error = await stuck.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(KernelError);
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);

    // The replacement worker serves the next request
    const next = client.evaluate(cube(2));
    expect(workers[1].sent).toHaveLength(1);
    workers[1].answerMesh(0, 2);
    expect((await next).triangleCount).toBe(2);
  });

  test("reports whether the kernel loaded", async () => {
    const { client, workers } = setup();
    const ready = client.init();
    workers[0].answer({ id: workers[0].sent[0].id, ok: true });
    expect(await ready).toBe(true);

    const failed = client.init();
    workers[0].answer({
      id: workers[0].sent[1].id,
      ok: false,
      error: "The B-rep kernel could not be loaded.",
      userFacing: true,
    });
    expect(await failed).toBe(false);
  });
});
