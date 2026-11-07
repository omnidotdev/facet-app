import { CSG, Polygon, Vector, Vertex } from "./csg";
import { hull3d } from "./hull";
import { KernelError } from "./kernel";
import {
  extrudeProfileMesh,
  profileRing,
  revolveProfileMesh,
} from "./meshSweep";
import { decodePolyhedron, triangulateFace } from "./polyhedron";
import { meshToStlBinary } from "./stl";
import { meshTo3mf } from "./threeMf";

import type { ExportFormat, Kernel, Mesh } from "./kernel";
import type { OpNode, Vec3 } from "./opgraph";

// --- Primitive solids as CSG polygon sets -----------------------------------

/**
 * Clamp a `segments` value to a safe positive loop count, mirroring the Rust
 * kernel's `segment_count` (`n.max(1) as u32`) so a zero or negative count
 * yields the same ring count in both kernels instead of diverging.
 */
function segmentCount(n: number): number {
  return Math.max(1, Math.floor(n));
}

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

/**
 * A truncated cone (OpenSCAD's cylinder(r1, r2, h) taper): a bottom ring at
 * radius `r1` and a top ring at `r2`, `slices` sides. The top cap is emitted
 * only when `r2 > 0`; when it is zero the top collapses to a sharp apex and the
 * side faces become triangles. The ring winds `[r*cos, -r*sin]` exactly like
 * the cylinder, so a cone with r1 == r2 coincides with a cylinder.
 */
function csgCone(
  r1: number,
  r2: number,
  h: number,
  center: boolean,
  slices: number,
): CSG {
  // The winding, cap, and apex logic here is duplicated across csgCone and
  // csgCylinder in both TS and Rust (four copies); keep all four geometrically
  // identical so a tweak to one is mirrored everywhere
  const z0 = center ? -h / 2 : 0;
  const z1 = z0 + h;
  const axisX = new Vector(1, 0, 0);
  const axisY = new Vector(0, -1, 0);
  const axisZ = new Vector(0, 0, 1);
  const bottom = new Vertex(new Vector(0, 0, z0), axisZ.negated());
  const top = new Vertex(new Vector(0, 0, z1), axisZ);
  // A point on the ring at a given radius and height. The per-vertex normal is
  // only a seed for CSG clipping; csgToMesh recomputes a flat face normal from
  // the winding, so each face reads flat regardless
  const ring = (radius: number, z: number, slice: number): Vertex => {
    const angle = slice * Math.PI * 2;
    const out = axisX.times(Math.cos(angle)).plus(axisY.times(Math.sin(angle)));
    return new Vertex(out.times(radius).plus(new Vector(0, 0, z)), out);
  };
  const polygons: Polygon[] = [];
  for (let i = 0; i < slices; i++) {
    const t0 = i / slices;
    const t1 = (i + 1) / slices;
    const b0 = ring(r1, z0, t0);
    const b1 = ring(r1, z0, t1);
    // Bottom cap always, wound like the cylinder's start cap
    polygons.push(new Polygon([bottom, b0, b1]));
    if (r2 > 0) {
      const u0 = ring(r2, z1, t0);
      const u1 = ring(r2, z1, t1);
      // Side quad wound like the cylinder: bottom t1, bottom t0, top t0, top t1
      polygons.push(new Polygon([b1, b0, u0, u1]));
      // Top cap only when the top ring has area
      polygons.push(new Polygon([top, u1, u0]));
    } else {
      // Sharp apex: the side is a triangle up to the single top point
      polygons.push(new Polygon([b1, b0, top]));
    }
  }
  return CSG.fromPolygons(polygons);
}

/**
 * Convex hull (OpenSCAD's hull()) of every child: evaluate each child to CSG,
 * pour all their vertex positions into one cloud, and wrap the hull triangles
 * back into a solid. `hull3d` returns each triangle wound outward, so the face
 * normal seeds outward and `csgToMesh` reads it flat; the same cloud and the
 * same `hull3d` run in the Rust kernel, so both tessellate identically.
 *
 * The cloud is de-duplicated by exact coordinate equality first: CSG polygons
 * repeat each shared vertex, so a sphere child would enter many times over and
 * make the hull needlessly O(n*F). The Rust `csg_hull` dedups byte-identically
 * (first occurrence wins), so the seed and triangulation stay bit-identical.
 */
function csgHull(children: OpNode[]): CSG {
  if (!children.length) throw new Error("hull needs at least one child");
  const seen = new Set<string>();
  const points: number[][] = [];
  for (const child of children) {
    for (const poly of evalNode(child).polygons) {
      for (const vert of poly.vertices) {
        // Number.toString round-trips each f64 to a unique shortest string, so
        // this key is exact f64 equality (and folds +0/-0 like `===`, which the
        // Rust side matches by canonicalizing a zero coordinate to +0)
        const key = `${vert.pos.x},${vert.pos.y},${vert.pos.z}`;
        if (seen.has(key)) continue;
        seen.add(key);
        points.push([vert.pos.x, vert.pos.y, vert.pos.z]);
      }
    }
  }
  const polygons = hull3d(points).map(([a, b, c]) => {
    const pa = new Vector(points[a][0], points[a][1], points[a][2]);
    const pb = new Vector(points[b][0], points[b][1], points[b][2]);
    const pc = new Vector(points[c][0], points[c][1], points[c][2]);
    const normal = pb.minus(pa).cross(pc.minus(pa)).unit();
    return new Polygon([
      new Vertex(pa, normal),
      new Vertex(pb, normal),
      new Vertex(pc, normal),
    ]);
  });
  return CSG.fromPolygons(polygons);
}

// Below this cross-product length a fan triangle has no area (collinear verts
// or a repeated index), so its normal is undefined; such a triangle is dropped
// rather than emitted with a NaN normal. Mirrors the hull EPS and the Rust
// csg_polyhedron guard, so both kernels drop the same triangles
const POLYHEDRON_DEGENERATE_EPS = 1e-9;

/**
 * An explicit mesh (OpenSCAD's polyhedron): decode the flat point and face
 * lists, fan-triangulate each face, and emit one CSG triangle per fan triangle.
 * Each triangle's normal is the flat outward normal from its winding
 * (`(p1 - p0) x (p2 - p0)`), so `csgToMesh` reads a flat per-triangle normal.
 * A zero-area fan triangle is skipped so no NaN normal reaches the output. The
 * same decode, triangulation, and degeneracy guard run in the Rust kernel over
 * the same flat lists, so the tessellation is bit-identical between the two.
 */
function csgPolyhedron(points: number[], faces: number[]): CSG {
  const decoded = decodePolyhedron(points, faces);
  const polygons: Polygon[] = [];
  for (const face of decoded.faces) {
    for (const [a, b, c] of triangulateFace(face)) {
      const pa = new Vector(
        decoded.points[a][0],
        decoded.points[a][1],
        decoded.points[a][2],
      );
      const pb = new Vector(
        decoded.points[b][0],
        decoded.points[b][1],
        decoded.points[b][2],
      );
      const pc = new Vector(
        decoded.points[c][0],
        decoded.points[c][1],
        decoded.points[c][2],
      );
      const raw = pb.minus(pa).cross(pc.minus(pa));
      // Drop a zero-area triangle: its unit normal would be NaN, and the
      // Polygon plane csgToMesh reads back would carry that NaN into the mesh
      if (raw.length() <= POLYHEDRON_DEGENERATE_EPS) continue;
      const normal = raw.unit();
      polygons.push(
        new Polygon([
          new Vertex(pa, normal),
          new Vertex(pb, normal),
          new Vertex(pc, normal),
        ]),
      );
    }
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
      return csgCylinder(
        node.r,
        node.h,
        node.center,
        segmentCount(node.segments),
      );
    case "cone":
      return csgCone(
        node.r1,
        node.r2,
        node.h,
        node.center,
        segmentCount(node.segments),
      );
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
    case "hull":
      return csgHull(node.children);
    case "polyhedron":
      return csgPolyhedron(node.points, node.faces);
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
