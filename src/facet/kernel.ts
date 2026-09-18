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

export type ExportFormat = "stl";

/**
 * The seam that matters. P1 ships a mesh/CSG kernel in TypeScript; a Rust
 * B-rep kernel (exact geometry, STEP export) implements the same interface in
 * P2. Kept synchronous for the P1 in-process kernel; goes Promise-based when
 * the WASM/worker kernel lands.
 */
export interface Kernel {
  readonly name: string;
  evaluate(node: OpNode): Mesh;
  export(node: OpNode, format: ExportFormat): Uint8Array;
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

export type Vec3f = [number, number, number];
