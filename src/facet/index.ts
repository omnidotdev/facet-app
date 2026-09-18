/** Facet engine: the public surface for authoring, evaluating, and exporting. */
export { box, cube, cylinder, difference, intersection, sphere, Shape, union } from "./api";
export { meshKernel, MeshKernel } from "./meshKernel";
export { meshToStlBinary } from "./stl";
export { meshBounds } from "./kernel";
export type { ExportFormat, Kernel, Mesh } from "./kernel";
export type { OpNode, Vec3 } from "./opgraph";
