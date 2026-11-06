/**
 * Main-thread client for the model sandbox worker. Posts model code + the
 * current parameter values and resolves with the op-graph + declarations the
 * worker produced. A hung worker (an infinite loop in model code) would block
 * every later build on the single worker, so a build that does not answer
 * within the timeout terminates and respawns it and resolves with an error.
 */

import type { BuildResult } from "@/facet/modelEval";
import type { ParamValue } from "@/params";

const BUILD_TIMEOUT_MS = 5000;

interface Pending {
  resolve: (result: BuildResult) => void;
  timer: number;
}

export class ModelRunner {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private seq = 0;

  constructor() {
    this.worker = this.spawn();
  }

  private spawn(): Worker {
    const worker = new Worker(new URL("./modelWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<BuildResult & { id: number }>) => {
      const { id, ...result } = event.data;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.resolve(result);
    };
    // A failure to load/run the worker would otherwise hang every build; fail
    // the in-flight ones with a user-facing error rather than leave them pending
    worker.onerror = (event) => {
      const message = event.message || "The model engine failed to start.";
      console.error("Facet model worker error:", message);
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.resolve({ ok: false, error: message });
      }
      this.pending.clear();
    };
    return worker;
  }

  private respawn(cancelError: string): void {
    this.worker.terminate();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, error: cancelError });
    }
    this.pending.clear();
    this.worker = this.spawn();
  }

  build(
    code: string,
    values: Record<string, ParamValue>,
  ): Promise<BuildResult> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        this.respawn("Evaluation was cancelled.");
        resolve({
          ok: false,
          error: "Model took too long to evaluate (possible infinite loop).",
        });
      }, BUILD_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      this.worker.postMessage({ id, code, values });
    });
  }

  dispose(): void {
    this.worker.terminate();
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
  }
}
