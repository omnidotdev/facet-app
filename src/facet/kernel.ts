import type { OpNode } from "./opgraph";

/**
 * A tessellated, non-indexed triangle mesh ready for display or export.
 * Three floats per vertex, three vertices per triangle. Normals are flat
 * (per-face), one per vertex, so shading reads the facets crisply.
 */
export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  triangleCount: number;
}

export type ExportFormat = "stl" | "3mf" | "step";

/**
 * A kernel error whose message is written for the user, so the Studio may show
 * it verbatim (e.g. "STEP export needs the B-rep kernel"). Any error that is
 * not a `KernelError` is treated as an internal detail: it is logged and
 * replaced with a generic message, never surfaced raw.
 */
export class KernelError extends Error {}

/**
 * The seam that matters. P1 ships a mesh/CSG kernel in TypeScript; a Rust
 * B-rep kernel (exact geometry, STEP export) implements the same interface in
 * P2. Synchronous for the in-process kernels; the OCCT B-rep kernel runs in a
 * worker behind the Promise-based `AsyncKernel` below.
 */
/**
 * `preview` asks for a fast draft while a slider is dragged. A kernel may
 * approximate (the B-rep kernel flattens curved 2D merges to polygons at the
 * display tolerance) or ignore it; exports never pass it
 */
export interface EvaluateOptions {
  preview?: boolean;
}

export interface Kernel {
  readonly name: string;
  evaluate(node: OpNode, options?: EvaluateOptions): Mesh;
  export(node: OpNode, format: ExportFormat): Uint8Array;
}

/**
 * A kernel that runs off the main thread (the OCCT B-rep kernel in its worker).
 * Same contract as `Kernel`, but every call resolves asynchronously, so a slow
 * rebuild never blocks input or painting
 */
export interface AsyncKernel {
  readonly name: string;
  evaluate(node: OpNode, options?: EvaluateOptions): Promise<Mesh>;
  export(node: OpNode, format: ExportFormat): Promise<Uint8Array>;
}

/** Axis-aligned bounds of a mesh, handy for tests and framing the camera. */
export function meshBounds(mesh: Mesh): { min: Vec3f; max: Vec3f } {
  const min: Vec3f = [Infinity, Infinity, Infinity];
  const max: Vec3f = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = p[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

type Vec3f = [number, number, number];
