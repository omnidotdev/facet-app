import type { Mesh } from "./kernel";

/**
 * Turn a kernel's non-indexed triangle soup into a closed, indexed mesh for
 * export. Slicers read connectivity straight from a 3MF and rebuild it from
 * coordinates for an STL, and either way an open edge invites their mesh repair,
 * which is free to fill a real hole (a key-ring hole, a bore). Two things leave
 * edges open here:
 *
 * - every triangle carries its own private vertices, so nothing is shared until
 *   coincident vertices are welded
 * - the BSP mesh booleans split a face without splitting its neighbour, leaving
 *   a vertex on the middle of the neighbour's edge (a T-junction)
 *
 * So weld on a fixed grid, drop triangles that collapsed in the weld, then split
 * each triangle at the T-junction vertices along its unmatched edges. A mesh
 * that is already closed (the B-rep kernel's) passes through unchanged apart
 * from the weld.
 */

export interface IndexedMesh {
  /** Three coordinates per vertex */
  vertices: number[];
  /** Three vertex indices per triangle, counter-clockwise seen from outside */
  triangles: number[];
}

/** Weld grid, matching the precision 3MF coordinates are written at */
const WELD_GRID = 1e4;

/** How far off an edge a vertex may sit and still count as on it, in mm */
const ON_EDGE_TOLERANCE = 2e-4;

/** Repair passes; each one resolves the T-junctions a split exposes */
const MAX_PASSES = 8;

const snap = (v: number): number => Math.round(v * WELD_GRID) / WELD_GRID;

/** Weld coincident vertices and drop triangles that collapse to a line or point */
function weld(mesh: Mesh): IndexedMesh {
  const p = mesh.positions;
  const vertices: number[] = [];
  const triangles: number[] = [];
  const index = new Map<string, number>();
  const vertexId = (b: number): number => {
    const x = snap(p[b]);
    const y = snap(p[b + 1]);
    const z = snap(p[b + 2]);
    const key = `${x},${y},${z}`;
    let id = index.get(key);
    if (id === undefined) {
      id = vertices.length / 3;
      index.set(key, id);
      vertices.push(x, y, z);
    }
    return id;
  };
  for (let t = 0; t < mesh.triangleCount; t++) {
    const b = t * 9;
    const v1 = vertexId(b);
    const v2 = vertexId(b + 3);
    const v3 = vertexId(b + 6);
    if (v1 === v2 || v2 === v3 || v1 === v3) continue;
    triangles.push(v1, v2, v3);
  }
  return { vertices, triangles };
}

const edgeKey = (a: number, b: number): string => `${a}>${b}`;

/**
 * One T-junction pass: split every triangle that has an unmatched edge with
 * another boundary vertex lying along it. Returns the number of splits.
 */
function splitTJunctions(mesh: IndexedMesh): number {
  const { vertices: v, triangles: tri } = mesh;
  const directed = new Set<string>();
  for (let t = 0; t < tri.length; t += 3) {
    for (let k = 0; k < 3; k++)
      directed.add(edgeKey(tri[t + k], tri[t + ((k + 1) % 3)]));
  }

  // An edge is matched when a neighbour walks it the other way; only the ends
  // of unmatched edges can be T-junction vertices
  const open: [number, number][] = [];
  const boundary = new Set<number>();
  for (let t = 0; t < tri.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = tri[t + k];
      const b = tri[t + ((k + 1) % 3)];
      if (directed.has(edgeKey(b, a))) continue;
      open.push([t, k]);
      boundary.add(a);
      boundary.add(b);
    }
  }
  if (open.length === 0) return 0;

  // Bucket boundary vertices on a uniform grid so each edge only tests the
  // vertices near it
  const ids = [...boundary];
  const lo = [v[ids[0] * 3], v[ids[0] * 3 + 1], v[ids[0] * 3 + 2]];
  const hi = [...lo];
  for (const i of ids) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[i * 3 + k]);
      hi[k] = Math.max(hi[k], v[i * 3 + k]);
    }
  }
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-6);
  const cell = extent / Math.max(1, Math.cbrt(ids.length));
  const cellOf = (x: number, k: number) => Math.floor((x - lo[k]) / cell);
  const grid = new Map<string, number[]>();
  for (const i of ids) {
    const key = [0, 1, 2].map((k) => cellOf(v[i * 3 + k], k)).join(",");
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }

  // For each triangle, the vertices to insert along each of its three edges
  const inserts = new Map<number, [number, number][][]>();
  for (const [t, k] of open) {
    const a = tri[t + k];
    const b = tri[t + ((k + 1) % 3)];
    const ax = v[a * 3];
    const ay = v[a * 3 + 1];
    const az = v[a * 3 + 2];
    const dx = v[b * 3] - ax;
    const dy = v[b * 3 + 1] - ay;
    const dz = v[b * 3 + 2] - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 === 0) continue;
    const c0 = [0, 1, 2].map((k2) =>
      cellOf(Math.min(v[a * 3 + k2], v[b * 3 + k2]) - ON_EDGE_TOLERANCE, k2),
    );
    const c1 = [0, 1, 2].map((k2) =>
      cellOf(Math.max(v[a * 3 + k2], v[b * 3 + k2]) + ON_EDGE_TOLERANCE, k2),
    );
    const hits: [number, number][] = [];
    for (let i = c0[0]; i <= c1[0]; i++)
      for (let j = c0[1]; j <= c1[1]; j++)
        for (let l = c0[2]; l <= c1[2]; l++) {
          const bucket = grid.get(`${i},${j},${l}`);
          if (!bucket) continue;
          for (const w of bucket) {
            if (w === a || w === b) continue;
            const wx = v[w * 3] - ax;
            const wy = v[w * 3 + 1] - ay;
            const wz = v[w * 3 + 2] - az;
            const s = (wx * dx + wy * dy + wz * dz) / len2;
            if (s <= 0 || s >= 1) continue;
            const ex = wx - s * dx;
            const ey = wy - s * dy;
            const ez = wz - s * dz;
            if (ex * ex + ey * ey + ez * ez > ON_EDGE_TOLERANCE ** 2) continue;
            hits.push([s, w]);
          }
        }
    if (hits.length === 0) continue;
    hits.sort((m, n) => m[0] - n[0]);
    let perEdge = inserts.get(t);
    if (!perEdge) {
      perEdge = [[], [], []];
      inserts.set(t, perEdge);
    }
    perEdge[k] = hits;
  }
  if (inserts.size === 0) return 0;

  // Rebuild each split triangle as a fan over its refined outline, anchored at
  // a corner so the pieces keep the original winding
  const out: number[] = [];
  for (let t = 0; t < tri.length; t += 3) {
    const perEdge = inserts.get(t);
    if (!perEdge) {
      out.push(tri[t], tri[t + 1], tri[t + 2]);
      continue;
    }
    const ring: number[] = [];
    for (let k = 0; k < 3; k++) {
      ring.push(tri[t + k]);
      for (const [, w] of perEdge[k]) ring.push(w);
    }
    // Anchor the fan at a corner whose two adjacent edges are unsplit when one
    // exists, so no fan triangle lies flat along a split edge
    let anchor = -1;
    for (let k = 0; k < 3; k++) {
      if (perEdge[k].length === 0 && perEdge[(k + 2) % 3].length === 0) {
        anchor = ring.indexOf(tri[t + k]);
        break;
      }
    }
    if (anchor < 0) {
      // Every corner touches a split edge: fan from the centroid instead
      const c = v.length / 3;
      const cx = (v[tri[t] * 3] + v[tri[t + 1] * 3] + v[tri[t + 2] * 3]) / 3;
      const cy =
        (v[tri[t] * 3 + 1] + v[tri[t + 1] * 3 + 1] + v[tri[t + 2] * 3 + 1]) / 3;
      const cz =
        (v[tri[t] * 3 + 2] + v[tri[t + 1] * 3 + 2] + v[tri[t + 2] * 3 + 2]) / 3;
      v.push(cx, cy, cz);
      for (let i = 0; i < ring.length; i++)
        out.push(c, ring[i], ring[(i + 1) % ring.length]);
      continue;
    }
    const n = ring.length;
    for (let i = 1; i < n - 1; i++)
      out.push(
        ring[anchor],
        ring[(anchor + i) % n],
        ring[(anchor + i + 1) % n],
      );
  }
  mesh.triangles = out;
  return inserts.size;
}

/** Weld a kernel mesh and close its T-junctions, ready to write to a file */
export function repairForExport(mesh: Mesh): IndexedMesh {
  const indexed = weld(mesh);
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (splitTJunctions(indexed) === 0) break;
  }
  return indexed;
}
