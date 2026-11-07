/** Facet engine: the public surface for authoring, evaluating, and exporting. */
export {
  Shape,
  Sketch,
  box,
  circle,
  cube,
  cylinder,
  difference,
  extrude,
  grid,
  importSvg,
  intersection,
  polygon,
  rect,
  rectTube,
  revolve,
  sphere,
  square,
  union,
} from "./api";
export { KernelError, meshBounds } from "./kernel";
export { MeshKernel, meshKernel } from "./meshKernel";
export { requiresBrep, shouldAutoSwitchToBrep } from "./opgraph";
export { meshToStlBinary } from "./stl";

export type { ExportFormat, Kernel, Mesh } from "./kernel";
export type { OpNode, Vec3 } from "./opgraph";
