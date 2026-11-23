/// <reference lib="webworker" />

/**
 * Finds a large solid's crease edges off the main thread. The weld and
 * T-junction pass behind it takes a few hundred milliseconds on a mesh of tens
 * of thousands of triangles, which on the main thread would stall the view
 * after every rebuild; here the view keeps moving and the lines arrive a
 * moment later
 */

import { creaseEdgeFlags } from "@/gpu/renderMode";

/** A request: the solid's positions, already copied for transfer */
export interface CreaseRequest {
  id: number;
  positions: Float32Array;
  triangleCount: number;
}

/** The reply: per-vertex edge flags for the same solid */
export interface CreaseResponse {
  id: number;
  flags: Float32Array;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<CreaseRequest>) => {
  const { id, positions, triangleCount } = event.data;
  const flags = creaseEdgeFlags({
    positions,
    // Crease detection reads positions only
    normals: new Float32Array(0),
    triangleCount,
  });
  const reply: CreaseResponse = { id, flags };
  scope.postMessage(reply, [flags.buffer]);
};
