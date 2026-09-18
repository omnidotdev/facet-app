import { describe, expect, test } from "bun:test";
import { cube, cylinder, sphere } from "./api";
import { meshBounds } from "./kernel";
import type { Mesh } from "./kernel";
import { meshKernel } from "./meshKernel";
import { meshToStlBinary } from "./stl";

/** Signed volume of a closed triangle mesh (divergence theorem). */
function meshVolume(mesh: Mesh): number {
  let v = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const b = t * 9;
    const ax = p[b], ay = p[b + 1], az = p[b + 2];
    const bx = p[b + 3], by = p[b + 4], bz = p[b + 5];
    const cx = p[b + 6], cy = p[b + 7], cz = p[b + 8];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
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
