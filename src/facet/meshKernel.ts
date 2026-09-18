import { CSG, Polygon, Vector, Vertex } from "./csg";
import type { ExportFormat, Kernel, Mesh } from "./kernel";
import type { OpNode, Vec3 } from "./opgraph";
import { meshToStlBinary } from "./stl";

// --- Primitive solids as CSG polygon sets -----------------------------------

function csgCube(center: Vec3, radius: Vec3): CSG {
  const c = new Vector(center[0], center[1], center[2]);
  const faces: Array<[number[], Vec3]> = [
    [[0, 4, 6, 2], [-1, 0, 0]],
    [[1, 3, 7, 5], [1, 0, 0]],
    [[0, 1, 5, 4], [0, -1, 0]],
    [[2, 6, 7, 3], [0, 1, 0]],
    [[0, 2, 3, 1], [0, 0, -1]],
    [[4, 5, 7, 6], [0, 0, 1]],
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
    const dir = new Vector(Math.cos(t) * Math.sin(p), Math.cos(p), Math.sin(t) * Math.sin(p));
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

function csgCylinder(r: number, h: number, center: boolean, slices: number): CSG {
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
    const normal = out.times(1 - Math.abs(normalBlend)).plus(axisZ.times(normalBlend));
    return new Vertex(pos, normal);
  };
  const polygons: Polygon[] = [];
  for (let i = 0; i < slices; i++) {
    const t0 = i / slices;
    const t1 = (i + 1) / slices;
    polygons.push(new Polygon([start, point(0, t0, -1), point(0, t1, -1)]));
    polygons.push(new Polygon([point(0, t1, 0), point(0, t0, 0), point(1, t0, 0), point(1, t1, 0)]));
    polygons.push(new Polygon([end, point(1, t1, 1), point(1, t0, 1)]));
  }
  return CSG.fromPolygons(polygons);
}

// --- Transforms (map vertex positions, planes recompute on rebuild) ---------

function mapVerts(csg: CSG, fn: (p: Vector) => Vector): CSG {
  return CSG.fromPolygons(
    csg.polygons.map((poly) => new Polygon(poly.vertices.map((v) => new Vertex(fn(v.pos), v.normal)))),
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
      const radius: Vec3 = [node.size[0] / 2, node.size[1] / 2, node.size[2] / 2];
      const center: Vec3 = node.center ? [0, 0, 0] : radius;
      return csgCube(center, radius);
    }
    case "sphere":
      return csgSphere(node.r, node.segments, Math.max(2, Math.round(node.segments / 2)));
    case "cylinder":
      return csgCylinder(node.r, node.h, node.center, node.segments);
    case "translate":
      return mapVerts(evalNode(node.child), (p) => p.plus(new Vector(node.v[0], node.v[1], node.v[2])));
    case "scale":
      return mapVerts(evalNode(node.child), (p) => new Vector(p.x * node.v[0], p.y * node.v[1], p.z * node.v[2]));
    case "rotate":
      return mapVerts(evalNode(node.child), (p) => rotatePoint(p, node.deg));
    case "union":
      return reduceBool(node.children, (a, b) => a.union(b));
    case "difference":
      return reduceBool(node.children, (a, b) => a.subtract(b));
    case "intersect":
      return reduceBool(node.children, (a, b) => a.intersect(b));
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
    if (format !== "stl") throw new Error(`unsupported export format: ${format}`);
    return meshToStlBinary(this.evaluate(node));
  }
}

export const meshKernel = new MeshKernel();
