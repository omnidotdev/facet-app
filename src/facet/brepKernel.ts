// Vite emits the 22 MB OCCT wasm as a hashed asset and hands back its URL; the
// `?url` import pulls in only that string, never the binary, so the main bundle
// stays lean and the wasm is fetched on demand the first time this kernel loads
import wasmUrl from "replicad-opencascadejs/wasm?url";

import { KernelError } from "./kernel";
import { meshToStlBinary } from "./stl";
import { meshTo3mf } from "./threeMf";

import type { Shape3D } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import type { ExportFormat, Kernel, Mesh } from "./kernel";
import type { OpNode } from "./opgraph";

/** The replicad module surface, typed without pulling it into the bundle. */
type Replicad = typeof import("replicad");

/** replicad's `localGC` registrar: tracks an OCCT handle and returns it. */
type Keep = ReturnType<Replicad["localGC"]>[0];

// Tessellation density used when converting an exact B-rep solid to a display
// mesh. The linear tolerance is in model units, the angular one in radians
const MESH_TOLERANCE = 0.1;
const MESH_ANGULAR_TOLERANCE = 0.3;

// Degrees to radians, for the mesh-level rotation fallback
const DEG_TO_RAD = Math.PI / 180;

/**
 * A B-rep modeling limitation the user can act on. Its message is written for
 * the user, so the Studio may show it verbatim; any other kernel failure is
 * replaced with a generic message and the real detail is logged.
 */
class BrepModelingError extends KernelError {
  constructor(message: string) {
    super(message);
    this.name = "BrepModelingError";
  }
}

/**
 * Intermediate geometry during evaluation. Most ops stay in the exact B-rep
 * world (`brep`). A non-uniform scale has no analytic B-rep representation in
 * this OCCT build (it lacks a `BRepBuilderAPI_GTransform` binding), so it drops
 * to an already-tessellated `mesh` and later ops operate on that.
 */
type Geom = { kind: "brep"; shape: Shape3D } | { kind: "mesh"; mesh: Mesh };

/** Apply Facet's intrinsic XYZ Euler rotation to a single point or vector. */
function rotatePoint(
  x: number,
  y: number,
  z: number,
  deg: [number, number, number],
): [number, number, number] {
  const ax = deg[0] * DEG_TO_RAD;
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const ay = deg[1] * DEG_TO_RAD;
  const cy = Math.cos(ay);
  const sy = Math.sin(ay);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const az = deg[2] * DEG_TO_RAD;
  const cz = Math.cos(az);
  const sz = Math.sin(az);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return [x, y, z];
}

/**
 * Tessellate an OCCT solid into Facet's non-indexed triangle mesh. OCCT yields
 * an indexed mesh with smooth per-vertex normals, so de-index it: three
 * vertices per triangle, each carrying its own normal (curved faces shade
 * smoothly, which the exact kernel earns over the faceted mesh kernel). The
 * returned arrays are copied out of OCCT, so the caller may free the solid.
 */
function shapeToMesh(shape: Shape3D): Mesh {
  const m = shape.mesh({
    tolerance: MESH_TOLERANCE,
    angularTolerance: MESH_ANGULAR_TOLERANCE,
  });
  const indices = m.triangles;
  const verts = m.vertices;
  const vertNormals = m.normals;
  const count = indices.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const src = indices[i] * 3;
    const dst = i * 3;
    positions[dst] = verts[src];
    positions[dst + 1] = verts[src + 1];
    positions[dst + 2] = verts[src + 2];
    normals[dst] = vertNormals[src];
    normals[dst + 1] = vertNormals[src + 1];
    normals[dst + 2] = vertNormals[src + 2];
  }
  return { positions, normals, triangleCount: count / 3 };
}

/** Collapse any geometry to a mesh, tessellating a B-rep solid if needed. */
function toMesh(geom: Geom): Mesh {
  return geom.kind === "brep" ? shapeToMesh(geom.shape) : geom.mesh;
}

/** Translate a mesh in place-free fashion, returning fresh arrays. */
function translateMesh(mesh: Mesh, v: [number, number, number]): Mesh {
  const positions = mesh.positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += v[0];
    positions[i + 1] += v[1];
    positions[i + 2] += v[2];
  }
  return {
    positions,
    normals: mesh.normals,
    triangleCount: mesh.triangleCount,
  };
}

/** Rotate a mesh (positions and normals) by Facet's XYZ Euler convention. */
function rotateMesh(mesh: Mesh, deg: [number, number, number]): Mesh {
  const positions = mesh.positions.slice();
  const normals = mesh.normals.slice();
  for (let i = 0; i < positions.length; i += 3) {
    const [px, py, pz] = rotatePoint(
      positions[i],
      positions[i + 1],
      positions[i + 2],
      deg,
    );
    positions[i] = px;
    positions[i + 1] = py;
    positions[i + 2] = pz;
    const [nx, ny, nz] = rotatePoint(
      normals[i],
      normals[i + 1],
      normals[i + 2],
      deg,
    );
    normals[i] = nx;
    normals[i + 1] = ny;
    normals[i + 2] = nz;
  }
  return { positions, normals, triangleCount: mesh.triangleCount };
}

/**
 * Scale a mesh component-wise. Positions scale directly; normals transform by
 * the inverse-transpose (divide by each factor) and renormalize, so a
 * non-uniform scale keeps lighting correct.
 */
function scaleMesh(mesh: Mesh, v: [number, number, number]): Mesh {
  const positions = mesh.positions.slice();
  const normals = mesh.normals.slice();
  const inv: [number, number, number] = [1 / v[0], 1 / v[1], 1 / v[2]];
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] *= v[0];
    positions[i + 1] *= v[1];
    positions[i + 2] *= v[2];
    const nx = normals[i] * inv[0];
    const ny = normals[i + 1] * inv[1];
    const nz = normals[i + 2] * inv[2];
    const len = Math.hypot(nx, ny, nz) || 1;
    normals[i] = nx / len;
    normals[i + 1] = ny / len;
    normals[i + 2] = nz / len;
  }
  return { positions, normals, triangleCount: mesh.triangleCount };
}

/**
 * Translate the op-graph into replicad geometry. Primitives and booleans stay
 * exact; transforms stay exact where OCCT supports them, else drop to a mesh.
 * Factored out of the kernel so it is testable with an injected replicad module.
 *
 * Every OCCT handle created along the way is a C++ object that must be freed, so
 * register each with `localGC` and sweep them once the mesh (copied-out typed
 * arrays) is in hand. The registry is a Set, so sweeping tolerates a handle a
 * boolean already freed, and the sweep in `finally` runs even on a throw.
 */
export function evaluateOpGraph(rc: Replicad, node: OpNode): Mesh {
  const [keep, gc] = rc.localGC();
  try {
    return toMesh(evalNode(rc, keep, node));
  } finally {
    gc();
  }
}

/**
 * Evaluate the op-graph to its exact B-rep solid and serialize that solid to an
 * ISO-10303-21 STEP byte stream. STEP carries exact analytic geometry, so it
 * must come from the solid itself, never the display mesh: a model that dropped
 * to a mesh (an unsupported op such as a non-uniform scale) has no exact B-rep
 * and is refused with a user-safe message. Shares the `localGC` discipline of
 * `evaluateOpGraph`: every handle, including the evaluated solid, is swept once
 * the STEP bytes are copied out of the wasm heap.
 */
export function exportOpGraphStep(rc: Replicad, node: OpNode): Uint8Array {
  const [keep, gc] = rc.localGC();
  try {
    const geom = evalNode(rc, keep, node);
    if (geom.kind !== "brep")
      throw new BrepModelingError(
        "STEP export needs exact geometry; this model used an unsupported operation.",
      );
    return shapeToStepBytes(rc.getOC(), geom.shape);
  } finally {
    gc();
  }
}

/**
 * Write a single exact solid to an ISO-10303-21 STEP (AP242) byte stream. This
 * mirrors replicad's `blobSTEP`, but reads the bytes straight out of OCCT's
 * in-memory filesystem with `oc.FS.readFile` so the result is a synchronous
 * `Uint8Array`, not a `Blob` whose async `arrayBuffer()` would force the whole
 * export path async. Schema 5 selects AP242, the manufacturing-grade protocol
 * that carries exact analytic surfaces (planes, cylinders) rather than a mesh.
 * The writer and progress handles are raw OCCT objects, not replicad shapes, so
 * `localGC` does not track them: free them by hand once the bytes are copied.
 */
function shapeToStepBytes(oc: OpenCascadeInstance, shape: Shape3D): Uint8Array {
  const path = "/facet-model.step";
  const writer = new oc.STEPControl_Writer();
  const progress = new oc.Message_ProgressRange();
  // Write writes the MEMFS file, so track whether it landed and always clean it
  // up in finally: an abort before the read must not leave a stale file behind
  let written = false;
  try {
    oc.Interface_Static.SetIVal("write.step.schema", 5);
    const transferred = writer.Transfer(
      shape.wrapped,
      oc.STEPControl_StepModelType.STEPControl_AsIs,
      true,
      progress,
    );
    if (transferred !== oc.IFSelect_ReturnStatus.IFSelect_RetDone)
      throw new Error("STEP transfer did not complete");
    written = writer.Write(path) === oc.IFSelect_ReturnStatus.IFSelect_RetDone;
    if (!written) throw new Error("STEP write did not complete");
    // readFile copies the bytes out of the wasm heap into a fresh array, so the
    // MEMFS file can be freed right after (the unlink runs in finally)
    return oc.FS.readFile(path);
  } finally {
    writer.delete();
    progress.delete();
    // Only a successful write created the file; guard the unlink so a cleanup
    // failure never masks the original error
    if (written) {
      try {
        oc.FS.unlink(path);
      } catch {
        // Best-effort cleanup; the path is constant so a leftover is bounded
      }
    }
  }
}

function evalNode(rc: Replicad, keep: Keep, node: OpNode): Geom {
  switch (node.op) {
    case "cube": {
      const [sx, sy, sz] = node.size;
      // Facet centers a cube on the origin or anchors its corner there
      const corner1 = node.center
        ? ([-sx / 2, -sy / 2, -sz / 2] as [number, number, number])
        : ([0, 0, 0] as [number, number, number]);
      const corner2 = node.center
        ? ([sx / 2, sy / 2, sz / 2] as [number, number, number])
        : ([sx, sy, sz] as [number, number, number]);
      return { kind: "brep", shape: keep(rc.makeBox(corner1, corner2)) };
    }
    case "sphere":
      // The exact sphere is segment-free; `segments` is a mesh-kernel notion and
      // the tessellation tolerance governs triangle density here
      return { kind: "brep", shape: keep(rc.makeSphere(node.r)) };
    case "cylinder": {
      // Axis along +Z, matching the mesh kernel: base at the origin, or centered
      const location: [number, number, number] = node.center
        ? [0, 0, -node.h / 2]
        : [0, 0, 0];
      return {
        kind: "brep",
        shape: keep(rc.makeCylinder(node.r, node.h, location, [0, 0, 1])),
      };
    }
    case "translate": {
      const child = evalNode(rc, keep, node.child);
      if (child.kind === "mesh")
        return { kind: "mesh", mesh: translateMesh(child.mesh, node.v) };
      return {
        kind: "brep",
        shape: keep(child.shape.translate(node.v[0], node.v[1], node.v[2])),
      };
    }
    case "rotate": {
      const child = evalNode(rc, keep, node.child);
      if (child.kind === "mesh")
        return { kind: "mesh", mesh: rotateMesh(child.mesh, node.deg) };
      // Compose X then Y then Z about the world origin to match the mesh kernel's
      // intrinsic XYZ Euler order, registering each intermediate solid
      const rx = keep(child.shape.rotate(node.deg[0], [0, 0, 0], [1, 0, 0]));
      const ry = keep(rx.rotate(node.deg[1], [0, 0, 0], [0, 1, 0]));
      const shape = keep(ry.rotate(node.deg[2], [0, 0, 0], [0, 0, 1]));
      return { kind: "brep", shape };
    }
    case "scale": {
      const child = evalNode(rc, keep, node.child);
      const [sx, sy, sz] = node.v;
      const uniform = sx === sy && sy === sz;
      if (child.kind === "brep" && uniform)
        return { kind: "brep", shape: keep(child.shape.scale(sx)) };
      // A non-uniform scale has no analytic B-rep here, so tessellate and scale
      // the mesh instead
      return { kind: "mesh", mesh: scaleMesh(toMesh(child), node.v) };
    }
    case "fillet": {
      const shape = requireBrep(evalNode(rc, keep, node.child), "Fillet");
      // A bare radius rounds every edge; OCCT refuses (StdFail_NotDone) if the
      // radius cannot fit the geometry, which surfaces as the generic B-rep error
      return { kind: "brep", shape: keep(shape.fillet(node.radius)) };
    }
    case "chamfer": {
      const shape = requireBrep(evalNode(rc, keep, node.child), "Chamfer");
      // A bare size bevels every edge, mirroring fillet
      return { kind: "brep", shape: keep(shape.chamfer(node.size)) };
    }
    case "shell": {
      const shape = requireBrep(evalNode(rc, keep, node.child), "Shell");
      // Facet's positive thickness hollows inward, so negate for replicad's
      // sign convention; open the topmost +Z face, the common enclosure case
      const shelled = shape.shell(-node.thickness, (finder, s) =>
        finder.when(rc.topMost(s)).parallelTo("XY"),
      );
      return { kind: "brep", shape: keep(shelled) };
    }
    case "union":
      return booleanOp(rc, keep, node.children, (a, b) => a.fuse(b));
    case "difference":
      return booleanOp(rc, keep, node.children, (a, b) => a.cut(b));
    case "intersect":
      return booleanOp(rc, keep, node.children, (a, b) => a.intersect(b));
  }
}

/**
 * Unwrap a child that must be an exact B-rep solid. Fillet, chamfer, and shell
 * work on exact topology, so a child that dropped to a tessellated mesh (an
 * earlier uneven scale) cannot carry them and the user is told why.
 */
function requireBrep(geom: Geom, op: string): Shape3D {
  if (geom.kind !== "brep")
    throw new BrepModelingError(
      `${op} needs an exact B-rep solid, but an earlier uneven scale turned this shape into a mesh.`,
    );
  return geom.shape;
}

function booleanOp(
  rc: Replicad,
  keep: Keep,
  children: OpNode[],
  combine: (a: Shape3D, b: Shape3D) => Shape3D,
): Geom {
  if (!children.length) throw new Error("boolean op needs at least one child");
  const parts = children.map((child) => evalNode(rc, keep, child));
  const shapes: Shape3D[] = [];
  for (const part of parts) {
    if (part.kind !== "brep")
      throw new BrepModelingError(
        "The B-rep kernel can't combine a shape that was scaled unevenly.",
      );
    shapes.push(part.shape);
  }
  return { kind: "brep", shape: shapes.reduce((a, b) => keep(combine(a, b))) };
}

// Cache the one-time async load so selecting the kernel again is instant
let kernelPromise: Promise<Kernel | null> | null = null;

/**
 * Load the OpenCascade (OCCT) B-rep kernel in the browser via WebAssembly and
 * adapt it to the Kernel interface. Mirrors loadWasmKernel: async load, then a
 * synchronous evaluate/export. The OCCT wasm is ~6.9 MB gzipped, so callers
 * should load this on demand, not at app boot. Returns null on any failure so
 * the app degrades to the other kernels.
 */
export function loadBrepKernel(): Promise<Kernel | null> {
  if (kernelPromise) return kernelPromise;
  kernelPromise = (async () => {
    try {
      const [ocInit, rc] = await Promise.all([
        import("replicad-opencascadejs"),
        import("replicad"),
      ]);
      const oc = await ocInit.default({ locateFile: () => wasmUrl });
      rc.setOC(oc);

      // Keep a user-safe modeling message visible, but never leak a raw OCCT
      // exception to the UI: log the detail and surface a generic message
      const evaluate = (node: OpNode): Mesh => {
        try {
          return evaluateOpGraph(rc, node);
        } catch (err) {
          if (err instanceof BrepModelingError) throw err;
          console.warn("Facet OCCT/B-rep evaluation failed:", err);
          throw new BrepModelingError(
            "The B-rep kernel couldn't build this model.",
          );
        }
      };

      return {
        name: "facet-occt-brep",
        evaluate,
        export: (node: OpNode, format: ExportFormat): Uint8Array => {
          try {
            // STEP comes from the exact solid, never the mesh, so it has its own
            // evaluate-to-shape path; STL and 3MF stay mesh-based
            if (format === "step") return exportOpGraphStep(rc, node);
            const mesh = evaluate(node);
            if (format === "stl") return meshToStlBinary(mesh);
            if (format === "3mf") return meshTo3mf(mesh);
            throw new Error(`unsupported export format: ${format}`);
          } catch (err) {
            if (err instanceof BrepModelingError) throw err;
            console.warn("Facet OCCT/B-rep export failed:", err);
            throw new BrepModelingError(
              "The B-rep kernel couldn't export this model.",
            );
          }
        },
      } satisfies Kernel;
    } catch (err) {
      console.warn("Facet OCCT/B-rep kernel unavailable:", err);
      kernelPromise = null;
      return null;
    }
  })();
  return kernelPromise;
}
