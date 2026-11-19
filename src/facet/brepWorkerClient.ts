/**
 * Main-thread client for the B-rep kernel worker (see `brepWorker.ts`). It
 * exposes the worker as an `AsyncKernel`, so the Studio awaits rebuilds and
 * exports instead of blocking on them.
 *
 * Slider drags ask for a rebuild every animation frame, far faster than OCCT
 * can answer for a detailed part. Queueing them all would build a backlog of
 * stale meshes that takes seconds to drain, so evaluations coalesce: at most
 * one runs, and a newer request replaces any that is still waiting (the
 * replaced caller gets a `SupersededError`). Exports never coalesce.
 */

import { KernelError } from "@/facet/kernel";

import type { AsyncKernel, ExportFormat, Mesh } from "@/facet/kernel";
import type { OpNode } from "@/facet/opgraph";

export type BrepRequest =
  | { id: number; kind: "init" }
  | { id: number; kind: "evaluate"; node: OpNode }
  | { id: number; kind: "export"; node: OpNode; format: ExportFormat };

export type BrepResponse =
  | { id: number; ok: true; mesh?: Mesh; data?: Uint8Array }
  | { id: number; ok: false; error: string; userFacing: boolean };

/** The slice of `Worker` the client uses, so tests can drive a fake */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<BrepResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: BrepRequest): void;
  terminate(): void;
}

/** Rejection for an evaluation that a newer one replaced before it started */
export class SupersededError extends Error {
  constructor() {
    super("Superseded by a newer evaluation");
    this.name = "SupersededError";
  }
}

// A real part rebuilds in seconds even on a slow machine; past this the worker
// is presumed stuck, so it is replaced rather than left blocking every request
const DEFAULT_TIMEOUT_MS = 120_000;

interface Pending {
  resolve: (response: BrepResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedEvaluation {
  node: OpNode;
  resolve: (mesh: Mesh) => void;
  reject: (reason: unknown) => void;
}

const spawnBrepWorker = (): WorkerLike =>
  new Worker(new URL("./brepWorker.ts", import.meta.url), {
    type: "module",
  }) as WorkerLike;

const failure = (
  id: number,
  error: string,
): Extract<BrepResponse, { ok: false }> => ({
  id,
  ok: false,
  error,
  userFacing: true,
});

/**
 * Turn a failed response into a KernelError the Studio can show verbatim. An
 * internal failure keeps its detail in the console and shows a generic message
 */
const toError = (response: Extract<BrepResponse, { ok: false }>) => {
  if (response.userFacing) return new KernelError(response.error);
  console.warn("Facet B-rep worker failed:", response.error);
  return new KernelError("The B-rep kernel couldn't build this model.");
};

export class BrepWorkerClient implements AsyncKernel {
  readonly name = "facet-occt-brep";
  private worker: WorkerLike;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private evaluating = false;
  private queued: QueuedEvaluation | null = null;

  constructor(
    private readonly spawn: () => WorkerLike = spawnBrepWorker,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.worker = this.start();
  }

  private start(): WorkerLike {
    const worker = this.spawn();
    worker.onmessage = (event) => {
      const entry = this.pending.get(event.data.id);
      if (!entry) return;
      this.pending.delete(event.data.id);
      clearTimeout(entry.timer);
      entry.resolve(event.data);
    };
    // A worker that fails to load would otherwise leave every request hanging
    worker.onerror = (event) => {
      console.error("Facet B-rep worker error:", event.message);
      this.failAll("The B-rep kernel stopped unexpectedly.");
    };
    return worker;
  }

  private failAll(error: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve(failure(id, error));
    }
    this.pending.clear();
  }

  private request(
    body:
      | { kind: "init" }
      | { kind: "evaluate"; node: OpNode }
      | { kind: "export"; node: OpNode; format: ExportFormat },
  ): Promise<BrepResponse> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        // Replace the stuck worker; everything in flight on it fails with it
        this.worker.terminate();
        this.failAll("The B-rep kernel took too long on this model.");
        resolve(failure(id, "The B-rep kernel took too long on this model."));
        this.worker = this.start();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.worker.postMessage({ id, ...body } as BrepRequest);
    });
  }

  /** Resolve true once the OCCT wasm has loaded in the worker */
  async init(): Promise<boolean> {
    const response = await this.request({ kind: "init" });
    return response.ok;
  }

  evaluate(node: OpNode): Promise<Mesh> {
    if (!this.evaluating) return this.startEvaluation(node);
    this.queued?.reject(new SupersededError());
    return new Promise((resolve, reject) => {
      this.queued = { node, resolve, reject };
    });
  }

  private startEvaluation(node: OpNode): Promise<Mesh> {
    this.evaluating = true;
    return this.request({ kind: "evaluate", node })
      .then((response) => {
        if (!response.ok) throw toError(response);
        if (!response.mesh)
          throw toError({
            ...response,
            ok: false,
            error: "no mesh in response",
            userFacing: false,
          });
        return response.mesh;
      })
      .finally(() => {
        this.evaluating = false;
        const next = this.queued;
        this.queued = null;
        if (next)
          this.startEvaluation(next.node).then(next.resolve, next.reject);
      });
  }

  async export(node: OpNode, format: ExportFormat): Promise<Uint8Array> {
    const response = await this.request({ kind: "export", node, format });
    if (!response.ok) throw toError(response);
    if (!response.data)
      throw toError({
        ...response,
        ok: false,
        error: "no data in response",
        userFacing: false,
      });
    return response.data;
  }

  dispose(): void {
    this.queued?.reject(new SupersededError());
    this.queued = null;
    this.failAll("The B-rep kernel was closed.");
    this.worker.terminate();
  }
}

// Cache the one-time load so selecting the kernel again is instant
let kernelPromise: Promise<AsyncKernel | null> | null = null;

/**
 * Start the B-rep worker and wait for its OCCT wasm (~6.9 MB gzipped) to load.
 * Load on demand, not at app boot. Returns null on failure so the Studio keeps
 * running on the other kernels, and a later call retries
 */
export function loadBrepWorkerKernel(): Promise<AsyncKernel | null> {
  if (kernelPromise) return kernelPromise;
  kernelPromise = (async () => {
    const client = new BrepWorkerClient();
    if (await client.init()) return client;
    client.dispose();
    kernelPromise = null;
    return null;
  })();
  return kernelPromise;
}
