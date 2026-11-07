/**
 * 3D convex hull of a point cloud, shared by all three kernels so `hull()`
 * produces identical geometry in the mesh and WASM kernels. A pure function
 * over `number[][]` points: it returns the hull's outward-facing triangles as
 * index triples into the input array, so a caller maps the indices back to
 * coordinates to build a mesh (or OCCT faces).
 *
 * The algorithm is an incremental (Beneath-Beyond) hull: seed a tetrahedron
 * from four extreme, non-coplanar points, then fold each remaining point in by
 * removing the faces it can see and coning the horizon to it. Every face is
 * oriented outward against a fixed interior point (the seed centroid, always
 * strictly inside the hull), so the winding is robust without tracking edge
 * directions. Because only input points become vertices and no coplanar sliver
 * faces are emitted, a triangulated convex hull of V vertices has exactly
 * 2V - 4 triangles (Euler): a tetrahedron is 4, a cube's 8 corners are 12.
 *
 * Every arithmetic step mirrors `crates/facet-kernel/src/hull.rs` exactly
 * (same comparisons, tie-breaks, and epsilon) so the two produce bit-identical
 * output on the same cloud; a divergence would regress the WASM kernel.
 */

// Distance tolerance below which the seed is treated as degenerate (all points
// coincident, collinear, or coplanar) and a point is treated as not visible.
// A true distance in model units, so the normal is normalized before the test
const EPS = 1e-9;

function sub(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** A hull face: three vertex indices plus its outward unit plane (n·x = w). */
interface Face {
  v: [number, number, number];
  n: number[];
  w: number;
}

/**
 * Compute the convex hull of `points` and return its outward-facing triangles
 * as `[i, j, k]` index triples into `points`. Throws when the cloud has fewer
 * than four non-coplanar points, so there is no 3D hull to build.
 */
export function hull3d(points: number[][]): number[][] {
  const n = points.length;
  const degenerate = () =>
    new Error("hull needs at least 4 non-coplanar points");
  if (n < 4) throw degenerate();

  // 1) p0: the lexicographically smallest point (min x, then y, then z). It is
  // always a hull vertex, and the choice is deterministic across kernels
  let i0 = 0;
  for (let i = 1; i < n; i++) {
    const a = points[i];
    const b = points[i0];
    if (
      a[0] < b[0] ||
      (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))
    )
      i0 = i;
  }

  // 2) p1: the point farthest from p0 (ties keep the lower index)
  let i1 = -1;
  let best = -1;
  for (let i = 0; i < n; i++) {
    if (i === i0) continue;
    const d = sub(points[i], points[i0]);
    const dist2 = dot(d, d);
    if (dist2 > best) {
      best = dist2;
      i1 = i;
    }
  }
  if (best <= EPS * EPS) throw degenerate();

  // 3) p2: the point farthest from the line p0-p1 (perpendicular distance)
  const e01 = sub(points[i1], points[i0]);
  const e01len2 = dot(e01, e01);
  let i2 = -1;
  best = -1;
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1) continue;
    const c = cross(sub(points[i], points[i0]), e01);
    const perp2 = dot(c, c) / e01len2;
    if (perp2 > best) {
      best = perp2;
      i2 = i;
    }
  }
  if (best <= EPS * EPS) throw degenerate();

  // 4) p3: the point farthest from the plane through p0, p1, p2
  const planeN = cross(
    sub(points[i1], points[i0]),
    sub(points[i2], points[i0]),
  );
  const planeNlen = Math.sqrt(dot(planeN, planeN));
  let i3 = -1;
  best = -1;
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2) continue;
    const d = Math.abs(dot(planeN, sub(points[i], points[i0]))) / planeNlen;
    if (d > best) {
      best = d;
      i3 = i;
    }
  }
  if (best <= EPS) throw degenerate();

  // The seed centroid is strictly inside the hull for its entire life, so every
  // face can be oriented outward against it with no winding bookkeeping
  const interior = [
    (points[i0][0] + points[i1][0] + points[i2][0] + points[i3][0]) / 4,
    (points[i0][1] + points[i1][1] + points[i2][1] + points[i3][1]) / 4,
    (points[i0][2] + points[i1][2] + points[i2][2] + points[i3][2]) / 4,
  ];

  // Build a face from three vertices, flipping it so its unit normal points
  // away from the interior point
  const makeFace = (a: number, b: number, c: number): Face => {
    let nrm = cross(sub(points[b], points[a]), sub(points[c], points[a]));
    const len = Math.sqrt(dot(nrm, nrm));
    // A correct hull never cones to a zero-area triangle, but guard the
    // division so a pathological cloud cannot divide by ~0 and inject a NaN
    // normal that (NaN compares false) is never deleted and rides into output.
    // len > EPS keeps the exact `nrm / len` path, bit-identical to before
    if (len > EPS) {
      nrm = [nrm[0] / len, nrm[1] / len, nrm[2] / len];
    } else {
      nrm = [0, 0, 0];
    }
    const w = dot(nrm, points[a]);
    if (dot(nrm, interior) - w > 0) {
      return { v: [a, c, b], n: [-nrm[0], -nrm[1], -nrm[2]], w: -w };
    }
    return { v: [a, b, c], n: nrm, w };
  };

  let faces: Face[] = [
    makeFace(i0, i1, i2),
    makeFace(i0, i1, i3),
    makeFace(i0, i2, i3),
    makeFace(i1, i2, i3),
  ];

  const seeded = new Set([i0, i1, i2, i3]);
  const key = (a: number, b: number): string => `${a},${b}`;

  for (let pi = 0; pi < n; pi++) {
    if (seeded.has(pi)) continue;
    const p = points[pi];
    // A face is visible if the point lies strictly in front of its outward
    // plane; a coplanar point (distance within EPS) is never visible, which
    // keeps flat sliver faces out and drops points interior to a face
    const visible = faces.map((f) => dot(f.n, p) - f.w > EPS);
    if (!visible.some(Boolean)) continue;

    // Directed edges of the visible region; an edge whose reverse twin is not
    // also visible borders a kept face, so it lies on the horizon loop
    const visibleEdges = new Set<string>();
    for (let fi = 0; fi < faces.length; fi++) {
      if (!visible[fi]) continue;
      const [a, b, c] = faces[fi].v;
      visibleEdges.add(key(a, b));
      visibleEdges.add(key(b, c));
      visibleEdges.add(key(c, a));
    }
    const horizon: Array<[number, number]> = [];
    for (let fi = 0; fi < faces.length; fi++) {
      if (!visible[fi]) continue;
      const [a, b, c] = faces[fi].v;
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ] as Array<[number, number]>) {
        if (!visibleEdges.has(key(v, u))) horizon.push([u, v]);
      }
    }

    const kept = faces.filter((_, fi) => !visible[fi]);
    for (const [u, v] of horizon) kept.push(makeFace(u, v, pi));
    faces = kept;
  }

  return faces.map((f) => [f.v[0], f.v[1], f.v[2]]);
}
