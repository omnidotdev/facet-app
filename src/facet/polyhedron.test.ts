import { describe, expect, test } from "bun:test";

import { decodePolyhedron, triangulateFace } from "./polyhedron";

describe("decodePolyhedron decodes a count-prefixed face list", () => {
  test("decodes points into triples and faces into index lists", () => {
    // A unit tetrahedron: 4 points, 4 triangular faces
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    const faces = [3, 0, 2, 1, 3, 0, 1, 3, 3, 1, 2, 3, 3, 2, 0, 3];
    const decoded = decodePolyhedron(points, faces);
    expect(decoded.points).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(decoded.faces).toEqual([
      [0, 2, 1],
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3],
    ]);
  });

  test("decodes a mixed face list with quads and triangles", () => {
    // Two points sets are not needed; just prove varied vertex counts decode
    const points = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1];
    const faces = [4, 0, 1, 2, 3, 3, 0, 1, 4];
    const decoded = decodePolyhedron(points, faces);
    expect(decoded.faces).toEqual([
      [0, 1, 2, 3],
      [0, 1, 4],
    ]);
  });

  test("an out-of-range vertex index throws", () => {
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    // index 3 does not exist (only 0..2)
    const faces = [3, 0, 1, 3];
    expect(() => decodePolyhedron(points, faces)).toThrow(/out-of-range/);
  });

  test("a negative vertex index throws", () => {
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const faces = [3, 0, 1, -1];
    expect(() => decodePolyhedron(points, faces)).toThrow(/out-of-range/);
  });

  test("a face with fewer than 3 vertices throws", () => {
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const faces = [2, 0, 1];
    expect(() => decodePolyhedron(points, faces)).toThrow(
      /at least 3 vertices/,
    );
  });

  test("points not a multiple of 3 throws", () => {
    const points = [0, 0, 0, 1, 0];
    const faces = [3, 0, 1, 2];
    expect(() => decodePolyhedron(points, faces)).toThrow(/x,y,z triples/);
  });

  test("a truncated face list throws", () => {
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    // claims 3 vertices but only 2 indices follow
    const faces = [3, 0, 1];
    expect(() => decodePolyhedron(points, faces)).toThrow();
  });

  test("an astronomically large face count throws as truncated, never traps", () => {
    const points = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    // 1e20 is a finite integral IEEE value, so it clears the >= 3 guard; it must
    // still be rejected as truncated (the Rust kernel must not cast it to a huge
    // usize and overflow its index math)
    const faces = [1e20, 0, 1, 2];
    expect(() => decodePolyhedron(points, faces)).toThrow(/truncated/);
  });
});

describe("triangulateFace fans a face into triangles", () => {
  test("a triangle stays a single triangle", () => {
    expect(triangulateFace([0, 1, 2])).toEqual([[0, 1, 2]]);
  });

  test("a quad fans into two triangles sharing vertex 0", () => {
    expect(triangulateFace([0, 1, 2, 3])).toEqual([
      [0, 1, 2],
      [0, 2, 3],
    ]);
  });

  test("a pentagon fans into three triangles", () => {
    expect(triangulateFace([5, 6, 7, 8, 9])).toEqual([
      [5, 6, 7],
      [5, 7, 8],
      [5, 8, 9],
    ]);
  });
});
