import { describe, expect, test } from "bun:test";

import { cone, cube, cylinder, polyhedron, sphere } from "./api";
import { meshBounds } from "./kernel";
import { meshKernel } from "./meshKernel";
import { meshToStlBinary } from "./stl";

import type { Mesh } from "./kernel";
import type { OpNode } from "./opgraph";

/** Signed volume of a closed triangle mesh (divergence theorem). */
function meshVolume(mesh: Mesh): number {
  let v = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const b = t * 9;
    const ax = p[b],
      ay = p[b + 1],
      az = p[b + 2];
    const bx = p[b + 3],
      by = p[b + 4],
      bz = p[b + 5];
    const cx = p[b + 6],
      cy = p[b + 7],
      cz = p[b + 8];
    v +=
      (ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx)) /
      6;
  }
  return Math.abs(v);
}

describe("mesh kernel evaluates the op-graph into geometry", () => {
  test("a centered cube is 12 triangles with the right bounds and volume", () => {
    const mesh = meshKernel.evaluate(cube(10).node);
    expect(mesh.triangleCount).toBe(12);
    const { min, max } = meshBounds(mesh);
    expect(min).toEqual([-5, -5, -5]);
    expect(max).toEqual([5, 5, 5]);
    expect(meshVolume(mesh)).toBeCloseTo(1000, 3);
  });

  test("a sphere approximates 4/3 pi r^3", () => {
    const mesh = meshKernel.evaluate(sphere(10, { segments: 48 }).node);
    const expected = (4 / 3) * Math.PI * 10 ** 3;
    // Inscribed tessellation undershoots the true sphere slightly.
    expect(meshVolume(mesh)).toBeGreaterThan(expected * 0.97);
    expect(meshVolume(mesh)).toBeLessThan(expected * 1.001);
  });

  test("subtracting an identical solid leaves nothing", () => {
    const mesh = meshKernel.evaluate(cube(10).subtract(cube(10)).node);
    expect(mesh.triangleCount).toBe(0);
  });

  test("union of two disjoint cubes sums their volume", () => {
    const node = cube(10).union(cube(10).translate(20, 0, 0)).node;
    expect(meshVolume(meshKernel.evaluate(node))).toBeCloseTo(2000, 2);
  });

  test("intersection keeps only the overlap", () => {
    const node = cube(10).intersect(cube(10).translate(5, 0, 0)).node;
    // Overlap is a 5 x 10 x 10 box.
    expect(meshVolume(meshKernel.evaluate(node))).toBeCloseTo(500, 2);
  });

  test("drilling a hole removes the cylinder's volume", () => {
    const node = cube(20).subtract(cylinder(5, 30, { segments: 64 })).node;
    const holeArea = 0.5 * 64 * 5 ** 2 * Math.sin((2 * Math.PI) / 64); // inscribed 64-gon
    const expected = 20 ** 3 - holeArea * 20;
    expect(meshVolume(meshKernel.evaluate(node))).toBeCloseTo(expected, -2);
  });

  test("a sharp-apex cone tessellates to a solid with the right bounds", () => {
    const mesh = meshKernel.evaluate(cone(2, 0, 4, { segments: 32 }).node);
    expect(mesh.triangleCount).toBeGreaterThan(0);
    const { min, max } = meshBounds(mesh);
    // Bottom radius 2 sets the X/Y diameter, centered height 4 runs -2 to 2 in Z
    expect(max[0] - min[0]).toBeCloseTo(4, 3);
    expect(max[2] - min[2]).toBeCloseTo(4, 3);
    // r1 ^ 2 * pi * h / 3 bounds an inscribed 32-gon cone from above
    expect(meshVolume(mesh)).toBeGreaterThan(0);
    expect(meshVolume(mesh)).toBeLessThan((Math.PI * 2 ** 2 * 4) / 3);
  });

  test("a truncated cone tessellates to a solid with the right bounds", () => {
    const mesh = meshKernel.evaluate(cone(2, 1, 4, { segments: 32 }).node);
    expect(mesh.triangleCount).toBeGreaterThan(0);
    const { min, max } = meshBounds(mesh);
    // The wider bottom radius 2 sets the X diameter, centered height 4 in Z
    expect(max[0] - min[0]).toBeCloseTo(4, 3);
    expect(max[2] - min[2]).toBeCloseTo(4, 3);
    // A frustum holds more volume than the sharp-apex cone of the same base
    const apexVolume = meshVolume(
      meshKernel.evaluate(cone(2, 0, 4, { segments: 32 }).node),
    );
    expect(meshVolume(mesh)).toBeGreaterThan(apexVolume);
  });
});

/**
 * Assert every triangle's flat normal points away from the solid's centroid.
 * The winding convention makes `(p1 - p0) x (p2 - p0)` the outward normal, so
 * for a convex solid it must agree with the vector from the centroid to the
 * triangle.
 */
function expectOutwardNormals(mesh: Mesh): void {
  const p = mesh.positions;
  // Centroid of all triangle vertices (good enough for a convex solid)
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const vertCount = p.length / 3;
  for (let i = 0; i < p.length; i += 3) {
    cx += p[i];
    cy += p[i + 1];
    cz += p[i + 2];
  }
  cx /= vertCount;
  cy /= vertCount;
  cz /= vertCount;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const b = t * 9;
    const ux = p[b + 3] - p[b];
    const uy = p[b + 4] - p[b + 1];
    const uz = p[b + 5] - p[b + 2];
    const vx = p[b + 6] - p[b];
    const vy = p[b + 7] - p[b + 1];
    const vz = p[b + 8] - p[b + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    // Centroid -> triangle first vertex
    const dx = p[b] - cx;
    const dy = p[b + 1] - cy;
    const dz = p[b + 2] - cz;
    expect(nx * dx + ny * dy + nz * dz).toBeGreaterThan(0);
  }
}

describe("polyhedron meshes an explicit solid with outward normals", () => {
  test("a unit tetrahedron is 4 triangles with positive volume and outward normals", () => {
    const mesh = meshKernel.evaluate(
      polyhedron(
        [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        [
          [0, 2, 1],
          [0, 1, 3],
          [1, 2, 3],
          [2, 0, 3],
        ],
      ).node,
    );
    expect(mesh.triangleCount).toBe(4);
    // A unit corner tetrahedron has volume 1/6
    expect(meshVolume(mesh)).toBeCloseTo(1 / 6, 10);
    expectOutwardNormals(mesh);
  });

  test("a cube from 8 points and 6 quad faces is 12 triangles with the right bbox", () => {
    const mesh = meshKernel.evaluate(
      polyhedron(
        [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
          [0, 1, 0],
          [0, 0, 1],
          [1, 0, 1],
          [1, 1, 1],
          [0, 1, 1],
        ],
        [
          [0, 3, 2, 1],
          [4, 5, 6, 7],
          [0, 1, 5, 4],
          [3, 7, 6, 2],
          [0, 4, 7, 3],
          [1, 2, 6, 5],
        ],
      ).node,
    );
    expect(mesh.triangleCount).toBe(12);
    const { min, max } = meshBounds(mesh);
    expect(min).toEqual([0, 0, 0]);
    expect(max).toEqual([1, 1, 1]);
    expect(meshVolume(mesh)).toBeCloseTo(1, 10);
    expectOutwardNormals(mesh);
  });

  test("an out-of-range vertex index throws", () => {
    expect(() =>
      meshKernel.evaluate({
        op: "polyhedron",
        points: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        faces: [3, 0, 1, 3],
      }),
    ).toThrow(/out-of-range/);
  });

  test("a degenerate face is dropped, leaving no NaN in the output", () => {
    // The four valid tetrahedron faces plus a zero-area face with a repeated
    // index ([0, 1, 0]) and a collinear face ([0, 1, ...]) that fan to zero-area
    // triangles; those must be skipped, not emitted with a NaN normal
    const mesh = meshKernel.evaluate({
      op: "polyhedron",
      points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      faces: [
        3, 0, 2, 1, 3, 0, 1, 3, 3, 1, 2, 3, 3, 2, 0, 3,
        // a triangle with a repeated vertex: zero area, must be dropped
        3, 0, 1, 0,
      ],
    });
    // Only the four real faces survive
    expect(mesh.triangleCount).toBe(4);
    for (const v of mesh.positions) expect(Number.isNaN(v)).toBe(false);
    for (const v of mesh.normals) expect(Number.isNaN(v)).toBe(false);
    expect(meshVolume(mesh)).toBeCloseTo(1 / 6, 10);
  });
});

describe("hull wraps a convex solid around its children", () => {
  // Eight unit cubes centered at the corners of a 10-unit box, so the cloud's
  // extreme points sit at +/-5.5 on every axis
  function cornerCubes(): OpNode {
    const children: OpNode[] = [];
    for (const x of [-5, 5])
      for (const y of [-5, 5])
        for (const z of [-5, 5])
          children.push({
            op: "translate",
            v: [x, y, z],
            child: { op: "cube", size: [1, 1, 1], center: true },
          });
    return { op: "hull", children };
  }

  test("hull of eight corner cubes fills the bounding box", () => {
    const mesh = meshKernel.evaluate(cornerCubes());
    expect(mesh.triangleCount).toBeGreaterThan(0);
    const { min, max } = meshBounds(mesh);
    for (let axis = 0; axis < 3; axis++) {
      expect(min[axis]).toBeCloseTo(-5.5, 5);
      expect(max[axis]).toBeCloseTo(5.5, 5);
    }
    // The convex hull is the solid 11-unit box (11^3 = 1331)
    expect(meshVolume(mesh)).toBeCloseTo(1331, 0);
  });

  test("hull of two separated spheres bridges the gap", () => {
    const sphereAt = (x: number): OpNode => ({
      op: "translate",
      v: [x, 0, 0],
      child: { op: "sphere", r: 3, segments: 12 },
    });
    const node: OpNode = { op: "hull", children: [sphereAt(0), sphereAt(20)] };
    const mesh = meshKernel.evaluate(node);
    const { min, max } = meshBounds(mesh);
    // The hull spans from the left pole of one sphere to the right of the other
    expect(min[0]).toBeCloseTo(-3, 5);
    expect(max[0]).toBeCloseTo(23, 5);
    // A single sphere (r = 3) is 4/3 pi r^3 ~ 113; the bridged hull holds far
    // more than the two spheres could as separate solids
    const oneSphere = (4 / 3) * Math.PI * 3 ** 3;
    expect(meshVolume(mesh)).toBeGreaterThan(2 * oneSphere);
  });

  test("hull needs at least one child", () => {
    expect(() => meshKernel.evaluate({ op: "hull", children: [] })).toThrow();
  });
});

describe("B-rep-only ops are rejected by the mesh kernel", () => {
  test("fillet asks the user to switch to the B-rep kernel", () => {
    expect(() => meshKernel.evaluate(cube(10).fillet(2).node)).toThrow(
      /B-rep kernel/,
    );
  });

  test("chamfer asks the user to switch to the B-rep kernel", () => {
    expect(() => meshKernel.evaluate(cube(10).chamfer(1).node)).toThrow(
      /B-rep kernel/,
    );
  });

  test("shell asks the user to switch to the B-rep kernel", () => {
    expect(() => meshKernel.evaluate(cube(10).shell(2).node)).toThrow(
      /B-rep kernel/,
    );
  });
});

describe("mirror reflects a solid and keeps it outward-facing", () => {
  test("mirror across the YZ plane flips a shape from +X to -X", () => {
    // A cube pushed to +X, mirrored across the plane with normal [1,0,0]
    const node = cube(10).translate(20, 0, 0).mirror([1, 0, 0]).node;
    const mesh = meshKernel.evaluate(node);
    const bounds = meshBounds(mesh);
    // It spanned 15..25 in X; after the flip it spans -25..-15
    expect(bounds.max[0]).toBeLessThan(0);
    expect(bounds.min[0]).toBeGreaterThan(-30);
    // Same box, so the same triangle count as the un-mirrored cube
    expect(mesh.triangleCount).toBe(
      meshKernel.evaluate(cube(10).node).triangleCount,
    );
  });

  test("a mirrored solid still booleans correctly (winding is not inverted)", () => {
    // If mirror left faces wound inside-out, the CSG subtraction would treat the
    // tool as empty and remove nothing. The tool (mirrored to span X -20..0)
    // overlaps the -X half of the base (X -10..10), so a correct subtraction
    // must carve that half away, leaving a solid that starts at x=0
    const base = cube(20);
    const tool = cube(20).translate(10, 0, 0).mirror([1, 0, 0]);
    const cut = meshKernel.evaluate(base.subtract(tool).node);
    const bounds = meshBounds(cut);
    expect(cut.triangleCount).toBeGreaterThan(0);
    // The -X half is gone: the result no longer reaches to x=-10
    expect(bounds.min[0]).toBeGreaterThan(-2);
    expect(bounds.max[0]).toBeCloseTo(10, 0);
  });
});

describe("STL export", () => {
  test("binary STL is 84 + 50 bytes per triangle", () => {
    const mesh = meshKernel.evaluate(cube(10).node);
    const stl = meshToStlBinary(mesh);
    expect(stl.byteLength).toBe(84 + mesh.triangleCount * 50);
    // Triangle count is echoed at byte offset 80, little-endian.
    const count = new DataView(stl.buffer).getUint32(80, true);
    expect(count).toBe(mesh.triangleCount);
  });
});

describe("STEP export is rejected by the mesh kernel", () => {
  test("STEP needs exact geometry, so point the user at the B-rep kernel", () => {
    expect(() => meshKernel.export(cube(10).node, "step")).toThrow(
      /B-rep kernel/,
    );
  });
});
