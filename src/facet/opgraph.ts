/**
 * The op-graph: a serializable tree of modeling operations.
 *
 * The authoring API (api.ts) builds one of these; a Kernel (kernel.ts)
 * evaluates it into geometry. Nothing here computes geometry, which is what
 * lets us swap the mesh/CSG kernel for a Rust B-rep kernel later without
 * touching the editor, viewport, or authoring surface.
 */

export type Vec3 = [number, number, number];

export type OpNode =
  | { op: "cube"; size: Vec3; center: boolean }
  | { op: "sphere"; r: number; segments: number }
  | { op: "cylinder"; r: number; h: number; segments: number; center: boolean }
  | { op: "translate"; v: Vec3; child: OpNode }
  | { op: "rotate"; deg: Vec3; child: OpNode }
  | { op: "scale"; v: Vec3; child: OpNode }
  | { op: "union"; children: OpNode[] }
  | { op: "difference"; children: OpNode[] }
  | { op: "intersect"; children: OpNode[] };
