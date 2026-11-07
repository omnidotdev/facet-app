/**
 * Decoding and triangulation for `polyhedron` (OpenSCAD's polyhedron): an
 * explicit mesh given as a flat list of x,y,z point triples plus a flat,
 * count-prefixed face list. This is shared by all three kernels so a polyhedron
 * decodes and triangulates identically everywhere; the Rust port in
 * `crates/facet-kernel/src/polyhedron.rs` mirrors it step for step.
 *
 * Winding convention (OpenSCAD's): each face lists its vertices so that, viewed
 * from OUTSIDE the solid, they run in a consistent rotational order. A flat
 * normal computed as `(p1 - p0) x (p2 - p0)` from that winding therefore points
 * outward. Callers that build a mesh wind each triangle the same way so its
 * normal faces out; test fixtures wind their faces to match.
 */

/** A polyhedron decoded into point triples and per-face vertex-index lists. */
export interface DecodedPolyhedron {
  points: [number, number, number][];
  faces: number[][];
}

/**
 * Decode a flat `points` list (x,y,z triples) and a flat, count-prefixed
 * `faces` list ([n, i0..i(n-1), m, j0..]) into point triples and index lists.
 * Throws a clear error when the point list is not a multiple of 3, a face
 * declares fewer than 3 vertices, the face list is truncated, or a vertex index
 * is out of range.
 */
export function decodePolyhedron(
  points: number[],
  faces: number[],
): DecodedPolyhedron {
  if (points.length % 3 !== 0)
    throw new Error(
      "polyhedron points must be a flat list of x,y,z triples (length divisible by 3)",
    );
  const pointCount = points.length / 3;
  const pointList: [number, number, number][] = [];
  for (let i = 0; i < points.length; i += 3)
    pointList.push([points[i], points[i + 1], points[i + 2]]);

  const faceList: number[][] = [];
  let i = 0;
  while (i < faces.length) {
    const n = faces[i];
    i += 1;
    if (!Number.isInteger(n) || n < 3)
      throw new Error("polyhedron needs at least 3 vertices per face");
    if (i + n > faces.length)
      throw new Error(
        "polyhedron face list is truncated: a face claims more vertices than remain",
      );
    const face: number[] = [];
    for (let k = 0; k < n; k++) {
      const idx = faces[i + k];
      if (!Number.isInteger(idx) || idx < 0 || idx >= pointCount)
        throw new Error("polyhedron face has an out-of-range vertex index");
      face.push(idx);
    }
    faceList.push(face);
    i += n;
  }
  return { points: pointList, faces: faceList };
}

/**
 * Fan-triangulate one face into triangle-index triples: `(i0, ik, ik+1)` for
 * k in 1..n-1. The fan preserves the face winding, so each triangle's outward
 * normal agrees with the face's.
 */
export function triangulateFace(face: number[]): [number, number, number][] {
  const tris: [number, number, number][] = [];
  for (let k = 1; k < face.length - 1; k++)
    tris.push([face[0], face[k], face[k + 1]]);
  return tris;
}
