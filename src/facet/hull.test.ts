import { describe, expect, test } from "bun:test";

import { hull3d } from "./hull";

/** Unique vertex indices referenced across a triangle-index list. */
function uniqueVertices(tris: number[][]): number {
  return new Set(tris.flat()).size;
}

describe("hull3d computes a 3D convex hull as outward triangles", () => {
  test("a tetrahedron is its own hull: 4 triangles, 4 vertices", () => {
    const pts = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const tris = hull3d(pts);
    expect(tris.length).toBe(4);
    expect(uniqueVertices(tris)).toBe(4);
  });

  test("the 8 corners of a cube hull to 12 triangles over 8 vertices", () => {
    const pts: number[][] = [];
    for (const x of [-1, 1])
      for (const y of [-1, 1]) for (const z of [-1, 1]) pts.push([x, y, z]);
    const tris = hull3d(pts);
    expect(tris.length).toBe(12);
    expect(uniqueVertices(tris)).toBe(8);
  });

  test("a point strictly inside the cloud is not a hull vertex", () => {
    const pts: number[][] = [];
    for (const x of [-1, 1])
      for (const y of [-1, 1]) for (const z of [-1, 1]) pts.push([x, y, z]);
    // The origin sits inside the cube, so it must be dropped from the hull
    pts.push([0, 0, 0]);
    const tris = hull3d(pts);
    expect(tris.length).toBe(12);
    expect(uniqueVertices(tris)).toBe(8);
    // The interior point is index 8; it must never appear in a triangle
    expect(tris.flat()).not.toContain(8);
  });

  test("every triangle faces outward (normal points away from the centroid)", () => {
    const pts: number[][] = [];
    for (const x of [-1, 1])
      for (const y of [-1, 1]) for (const z of [-1, 1]) pts.push([x, y, z]);
    const tris = hull3d(pts);
    const centroid = [0, 0, 0];
    for (const [a, b, c] of tris) {
      const pa = pts[a];
      const pb = pts[b];
      const pc = pts[c];
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      // Vector from the centroid to the face: the outward normal agrees with it
      const toFace = [
        pa[0] - centroid[0],
        pa[1] - centroid[1],
        pa[2] - centroid[2],
      ];
      const d = n[0] * toFace[0] + n[1] * toFace[1] + n[2] * toFace[2];
      expect(d).toBeGreaterThan(0);
    }
  });

  test("fewer than 4 points throws", () => {
    expect(() =>
      hull3d([
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ]),
    ).toThrow(/non-coplanar/);
  });

  test("collinear points throw", () => {
    expect(() =>
      hull3d([
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ]),
    ).toThrow(/non-coplanar/);
  });

  test("coplanar points throw", () => {
    // A unit square in the z = 0 plane: four points, no volume
    expect(() =>
      hull3d([
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ]),
    ).toThrow(/non-coplanar/);
  });
});
