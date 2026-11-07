import { describe, expect, test } from "bun:test";

import { cone, cube, cylinder, sphere } from "./api";
import { meshBounds } from "./kernel";
import { meshKernel } from "./meshKernel";
import { meshToStlBinary } from "./stl";

import type { Mesh } from "./kernel";

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
