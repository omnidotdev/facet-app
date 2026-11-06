/// <reference lib="webworker" />

/**
 * Sandbox worker: evaluates model code off the main thread. The worker global
 * scope has no window/document/localStorage, so model code cannot read the
 * session token or touch the page. It replies with the serializable op-graph +
 * param declarations (or an error), which the main thread renders.
 */

import { buildModel } from "@/facet/modelEval";

import type { ParamValue } from "@/params";

interface BuildRequest {
  id: number;
  code: string;
  values: Record<string, ParamValue>;
}

self.onmessage = (event: MessageEvent<BuildRequest>) => {
  const { id, code, values } = event.data;
  const result = buildModel(code, values);
  (self as DedicatedWorkerGlobalScope).postMessage({ id, ...result });
};
