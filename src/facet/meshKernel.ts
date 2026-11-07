import { CSG, Polygon, Vector, Vertex } from "./csg";
import { KernelError } from "./kernel";
import {
  extrudeProfileMesh,
  profileRing,
  revolveProfileMesh,
} from "./meshSweep";
import { meshToStlBinary } from "./stl";
import { meshTo3mf } from "./threeMf";

import type { ExportFormat, Kernel, Mesh } from "./kernel";
import type { OpNode, Vec3 } from "./opgraph";

// --- Primitive solids as CSG polygon sets -----------------------------------

function csgCube(center: Vec3, radius: Vec3): CSG {
  const c = new Vector(center[0], center[1], center[2]);
  const faces: Array<[number[], Vec3]> = [
    [
      [0, 4, 6, 2],
      [-1, 0, 0],
    ],
    [
      [1, 3, 7, 5],
      [1, 0, 0],
    ],
    [
      [0, 1, 5, 4],
      [0, -1, 0],
    ],
    [
      [2, 6, 7, 3],
      [0, 1, 0],
    ],
    [
      [0, 2, 3, 1],
      [0, 0, -1],
    ],
    [
      [4, 5, 7, 6],
      [0, 0, 1],
    ],
  ];
  const polygons = faces.map(([idx, n]) => {
    const normal = new Vector(n[0], n[1], n[2]);
    const verts = idx.map((i) => {
      const pos = new Vector(
        c.x + radius[0] * (2 * (i & 1 ? 1 : 0) - 1),
        c.y + radius[1] * (2 * (i & 2 ? 1 : 0) - 1),
        c.z + radius[2] * (2 * (i & 4 ? 1 : 0) - 1),
      );
      return new Vertex(pos, normal);
    });
    return new Polygon(verts);
  });
  return CSG.fromPolygons(polygons);
}

function csgSphere(r: number, slices: number, stacks: number): CSG {
  const polygons: Polygon[] = [];
  const vertex = (theta: number, phi: number, out: Vertex[]) => {
    const t = theta * Math.PI * 2;
    const p = phi * Math.PI;
    const dir = new Vector(
      Math.cos(t) * Math.sin(p),
      Math.cos(p),
      Math.sin(t) * Math.sin(p),
    );
    out.push(new Vertex(dir.times(r), dir));
  };
  for (let i = 0; i < slices; i++) {
    for (let j = 0; j < stacks; j++) {
      const verts: Vertex[] = [];
      vertex(i / slices, j / stacks, verts);
      if (j > 0) vertex((i + 1) / slices, j / stacks, verts);
      if (j < stacks - 1) vertex((i + 1) / slices, (j + 1) / stacks, verts);
      vertex(i / slices, (j + 1) / stacks, verts);
      polygons.push(new Polygon(verts));
    }
  }
  return CSG.fromPolygons(polygons);
}

function csgCylinder(
  r: number,
  h: number,
  center: boolean,
  slices: number,
): CSG {
  const z0 = center ? -h / 2 : 0;
  const z1 = center ? h / 2 : h;
  const s = new Vector(0, 0, z0);
  const e = new Vector(0, 0, z1);
  const ray = e.minus(s);
  const axisZ = ray.unit();
  // Matches csg.js orientation so side + cap normals face outward (a flipped
  // axisY makes the cylinder inside-out, which corrupts subtraction).
  const axisX = new Vector(1, 0, 0);
  const axisY = new Vector(0, -1, 0);
  const start = new Vertex(s, axisZ.negated());
  const end = new Vertex(e, axisZ);
  const point = (stack: number, slice: number, normalBlend: number): Vertex => {
    const angle = slice * Math.PI * 2;
    const out = axisX.times(Math.cos(angle)).plus(axisY.times(Math.sin(angle)));
    const pos = s.plus(ray.times(stack)).plus(out.times(r));
    const normal = out
      .times(1 - Math.abs(normalBlend))
      .plus(axisZ.times(normalBlend));
    return new Vertex(pos, normal);
  };
  const polygons: Polygon[] = [];
  for (let i = 0; i < slices; i++) {
    const t0 = i / slices;
    const t1 = (i + 1) / slices;
    polygons.push(new Polygon([start, point(0, t0, -1), point(0, t1, -1)]));
    polygons.push(
      new Polygon([
        point(0, t1, 0),
        point(0, t0, 0),
        point(1, t0, 0),
        point(1, t1, 0),
      ]),
    );
    polygons.push(new Polygon([end, point(1, t1, 1), point(1, t0, 1)]));
  }
  return CSG.fromPolygons(polygons);
}

// --- Transforms (map vertex positions, planes recompute on rebuild) ---------

function mapVerts(csg: CSG, fn: (p: Vector) => Vector): CSG {
  return CSG.fromPolygons(
    csg.polygons.map(
      (poly) =>
        new Polygon(poly.vertices.map((v) => new Vertex(fn(v.pos), v.normal))),
    ),
  );
}

/** Reflect a point or direction across the plane through the origin with unit normal n. */
function reflectAcross(v: Vector, n: Vector): Vector {
  const d = 2 * (v.x * n.x + v.y * n.y + v.z * n.z);
  return new Vector(v.x - d * n.x, v.y - d * n.y, v.z - d * n.z);
}

/**
 * Mirror a solid across the plane through the origin whose normal is `normal`.
 * A reflection flips handedness, so reflecting the vertices alone leaves every
 * polygon wound inside-out; reverse each polygon's winding (and reflect its
 * per-vertex normals) so the solid stays outward-facing. The Polygon rebuild
 * recomputes each plane from the corrected winding.
 */
function mirrorCsg(csg: CSG, normal: Vec3): CSG {
  const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const n = new Vector(normal[0] / len, normal[1] / len, normal[2] / len);
  return CSG.fromPolygons(
    csg.polygons.map((poly) => {
      const verts = poly.vertices.map(
        (v) => new Vertex(reflectAcross(v.pos, n), reflectAcross(v.normal, n)),
      );
      verts.reverse();
      return new Polygon(verts);
    }),
  );
}

function rotatePoint(p: Vector, deg: Vec3): Vector {
  const d = Math.PI / 180;
  let { x, y, z } = p;
  const ax = deg[0] * d;
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const ay = deg[1] * d;
  const cyv = Math.cos(ay);
  const syv = Math.sin(ay);
  [x, z] = [x * cyv + z * syv, -x * syv + z * cyv];
  const az = deg[2] * d;
  const cz = Math.cos(az);
  const sz = Math.sin(az);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return new Vector(x, y, z);
}

// --- Evaluate the op-graph --------------------------------------------------

function evalNode(node: OpNode): CSG {
  switch (node.op) {
    case "cube": {
      const radius: Vec3 = [
        node.size[0] / 2,
        node.size[1] / 2,
        node.size[2] / 2,
      ];
      const center: Vec3 = node.center ? [0, 0, 0] : radius;
      return csgCube(center, radius);
    }
    case "sphere":
      return csgSphere(
        node.r,
        node.segments,
        Math.max(2, Math.round(node.segments / 2)),
      );
    case "cylinder":
      return csgCylinder(node.r, node.h, node.center, node.segments);
    case "translate":
      return mapVerts(evalNode(node.child), (p) =>
        p.plus(new Vector(node.v[0], node.v[1], node.v[2])),
      );
    case "scale":
      return mapVerts(
        evalNode(node.child),
        (p) => new Vector(p.x * node.v[0], p.y * node.v[1], p.z * node.v[2]),
      );
    case "rotate":
      return mapVerts(evalNode(node.child), (p) => rotatePoint(p, node.deg));
    case "mirror":
      return mirrorCsg(evalNode(node.child), node.normal);
    case "union":
      return reduceBool(node.children, (a, b) => a.union(b));
    case "difference":
      return reduceBool(node.children, (a, b) => a.subtract(b));
    case "intersect":
      return reduceBool(node.children, (a, b) => a.intersect(b));
    // Exact-geometry ops have no mesh/CSG equivalent, so point the user at the
    // kernel that can do them rather than returning wrong geometry
    case "fillet":
      throw new KernelError(
        "Fillet needs the B-rep kernel. Switch the kernel to B-rep (OCCT).",
      );
    case "chamfer":
      throw new KernelError(
        "Chamfer needs the B-rep kernel. Switch the kernel to B-rep (OCCT).",
      );
    case "shell":
      throw new KernelError(
        "Shell needs the B-rep kernel. Switch the kernel to B-rep (OCCT).",
      );
    // extrude/revolve of a SIMPLE profile (circle/rect/polygon) is tessellated
    // here; a curved/combined profile (svg/text/offset/2D boolean) has no mesh
    // representation and routes to B-rep
    case "extrude": {
      const ring = profileRing(node.child);
      if (!ring)
        throw new KernelError(
          "This profile needs the B-rep kernel. Switch the kernel to B-rep (OCCT).",
        );
      return extrudeProfileMesh(ring, node.height, node.twist, node.scale);
    }
    case "revolve": {
      const ring = profileRing(node.child);
      if (!ring)
        throw new KernelError(
          "This profile needs the B-rep kernel. Switch the kernel to B-rep (OCCT).",
        );
      return revolveProfileMesh(ring, node.angle, node.segments);
    }
    // A bare 2D sketch is not a solid; the curved/combined 2D ops have no mesh
    // representation at all. Both route to the B-rep kernel
    case "circle2d":
    case "rect2d":
    case "polygon2d":
    case "svg2d":
    case "text2d":
    case "union2d":
    case "difference2d":
    case "intersect2d":
    case "offset2d":
      throw new KernelError(
        "2D sketches need the B-rep kernel, or extrude/revolve them. Switch the kernel to B-rep (OCCT).",
      );
  }
}

function reduceBool(children: OpNode[], fn: (a: CSG, b: CSG) => CSG): CSG {
  if (!children.length) throw new Error("boolean op needs at least one child");
  return children.map(evalNode).reduce((a, b) => fn(a, b));
}

function csgToMesh(csg: CSG): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const poly of csg.polygons) {
    const vs = poly.vertices;
    if (vs.length < 3) continue;
    const n = poly.plane.normal;
    // Fan-triangulate the (convex) polygon.
    for (let i = 2; i < vs.length; i++) {
      for (const v of [vs[0], vs[i - 1], vs[i]]) {
        positions.push(v.pos.x, v.pos.y, v.pos.z);
        normals.push(n.x, n.y, n.z);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    triangleCount: positions.length / 9,
  };
}

/** The P1 kernel: mesh CSG, in-process, synchronous. */
export class MeshKernel implements Kernel {
  readonly name = "facet-mesh-csg";
  evaluate(node: OpNode): Mesh {
    return csgToMesh(evalNode(node));
  }
  export(node: OpNode, format: ExportFormat): Uint8Array {
    // STEP is an exact-B-rep exchange format with no mesh equivalent, so point
    // the user at the kernel that can produce it rather than dumping triangles
    if (format === "step")
      throw new KernelError(
        "STEP export needs the B-rep kernel. Switch the kernel to B-rep (OCCT).",
      );
    const mesh = this.evaluate(node);
    if (format === "stl") return meshToStlBinary(mesh);
    if (format === "3mf") return meshTo3mf(mesh);
    throw new Error(`unsupported export format: ${format}`);
  }
}

export const meshKernel = new MeshKernel();
