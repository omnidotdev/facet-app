import { repairForExport } from "@/facet/meshRepair";

import type { Mesh } from "@/facet/kernel";
import type { Theme } from "@/theme";
import type { Rgba } from "./palette";

/**
 * How the solid is drawn:
 *
 * - shaded: lit solid, the default
 * - edges: lit solid with its creases and outline drawn as lines, the usual
 *   CAD look, which makes flat parts and small steps easy to read
 * - wireframe: every triangle edge, see-through, which shows how finely the
 *   part is tessellated (what an exported mesh will carry)
 * - xray: a translucent solid with its creases, so holes, bores, and anything
 *   behind the front faces show through
 */
export type RenderMode = "shaded" | "edges" | "wireframe" | "xray";

/** Every mode, in the order the switcher cycles through them */
export const RENDER_MODES: readonly RenderMode[] = [
  "shaded",
  "edges",
  "wireframe",
  "xray",
];

export const RENDER_MODE_LABELS: Record<RenderMode, string> = {
  shaded: "Shaded",
  edges: "Shaded with edges",
  wireframe: "Wireframe",
  xray: "X-ray",
};

/** The mode after `mode` in the cycle, wrapping back to the first */
export const nextRenderMode = (mode: RenderMode): RenderMode =>
  RENDER_MODES[(RENDER_MODES.indexOf(mode) + 1) % RENDER_MODES.length] ??
  "shaded";

const KEY = "facet:render-mode:v1";

/** A stored value as a mode, defaulting anything unknown to shaded */
export const parseRenderMode = (raw: unknown): RenderMode =>
  RENDER_MODES.includes(raw as RenderMode) ? (raw as RenderMode) : "shaded";

/** The saved mode for this browser, or shaded when unset or unreadable */
export const loadRenderMode = (): RenderMode => {
  try {
    return parseRenderMode(localStorage.getItem(KEY));
  } catch {
    return "shaded";
  }
};

/** Remember the mode for this browser; storage failures are ignored */
export const saveRenderMode = (mode: RenderMode): void => {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Private mode or blocked storage: the mode lasts for this session only
  }
};

/**
 * The shader inputs for a mode:
 *
 * - `style`: fill opacity (0 drops the fill), edge strength (0 draws no
 *   lines), half the line width in device pixels, and an unused channel
 * - `edgeColor`: the line color
 *
 * A fill opacity below 1 also tells the backend to blend and to stop writing
 * depth, so every layer of a see-through mode shows
 */
export interface RenderStyle {
  style: Rgba;
  edgeColor: Rgba;
}

const hex = (value: string, alpha = 1): Rgba => {
  const n = Number.parseInt(value.replace("#", ""), 16);
  return [
    ((n >> 16) & 0xff) / 255,
    ((n >> 8) & 0xff) / 255,
    (n & 0xff) / 255,
    alpha,
  ];
};

/** Line half-widths in CSS pixels, scaled to device pixels at use */
const EDGE_HALF_WIDTH = 0.75;
const WIRE_HALF_WIDTH = 0.6;

/** Resolve a mode's shader inputs for the theme and device pixel ratio */
export const renderStyleFor = (
  mode: RenderMode,
  theme: Theme,
  dpr: number,
): RenderStyle => {
  const scale = Math.max(dpr, 1);
  switch (mode) {
    case "edges":
      return {
        style: [1, 1, EDGE_HALF_WIDTH * scale, 0],
        // Dark lines read on the amber solid in both themes
        edgeColor: theme === "dark" ? hex("#1d140b") : hex("#3b2614"),
      };
    case "wireframe":
      return {
        style: [0, 1, WIRE_HALF_WIDTH * scale, 0],
        edgeColor: theme === "dark" ? hex("#f0a06a") : hex("#c25a22"),
      };
    case "xray":
      return {
        style: [0.22, 1, EDGE_HALF_WIDTH * scale, 0],
        edgeColor: theme === "dark" ? hex("#f6b27e") : hex("#a8471a"),
      };
    default:
      return { style: [1, 0, 0, 0], edgeColor: [0, 0, 0, 1] };
  }
};

/** Whether a mode needs crease detection (wireframe flags every edge instead) */
export const needsCreases = (mode: RenderMode): boolean =>
  mode === "edges" || mode === "xray";

/**
 * Per-vertex edge flags for drawing every triangle edge. Each vertex carries
 * the same three flags as the others in its triangle; flag `i` draws the edge
 * opposite the triangle's vertex `i`
 */
export const allEdgeFlags = (triangleCount: number): Float32Array =>
  new Float32Array(triangleCount * 9).fill(1);

/** Per-vertex edge flags that draw nothing */
export const noEdgeFlags = (triangleCount: number): Float32Array =>
  new Float32Array(triangleCount * 9);

/** Faces meeting at more than this angle form a crease worth drawing */
const CREASE_DEGREES = 30;

/** Matches the weld grid repairForExport snaps to */
const WELD_GRID = 1e4;
const snap = (v: number): number => Math.round(v * WELD_GRID) / WELD_GRID;

/** Tolerance, in mm, for a vertex to count as lying on an edge's line */
const ON_LINE = 2e-4;

/**
 * Per-vertex edge flags that draw the solid's creases (faces meeting at more
 * than 30 degrees) and any open boundary, but not the seams between triangles
 * of one flat face or the facets of a smoothly curved one.
 *
 * The mesh kernel's booleans split a face without splitting its neighbor, so
 * on the raw mesh an edge can have a vertex sitting in its middle (a
 * T-junction) and no single edge across from it. Connectivity therefore comes
 * from the welded, T-junction-free mesh the exporters use: each displayed edge
 * is walked over the welded vertices along it, and every welded piece records
 * which displayed triangles border it, and an edge is drawn when all of its
 * pieces are creases. Normals come from the displayed
 * triangles themselves, never the welded copy, whose grid snapping can tilt
 * the thin slivers a T-junction split leaves and fake a crease
 */
export const creaseEdgeFlags = (mesh: Mesh): Float32Array => {
  const n = mesh.triangleCount;
  const flags = new Float32Array(n * 9);
  if (n === 0) return flags;

  const welded = repairForExport(mesh);
  const v = welded.vertices;
  const tris = welded.triangles;
  const vertexCount = v.length / 3;

  // Welded vertex id by snapped position, to map display vertices onto it
  const idOf = new Map<string, number>();
  for (let i = 0; i < vertexCount; i++)
    idOf.set(`${v[i * 3]},${v[i * 3 + 1]},${v[i * 3 + 2]}`, i);

  // Which welded vertices are joined by an edge
  const neighbors: Set<number>[] = Array.from(
    { length: vertexCount },
    () => new Set<number>(),
  );
  for (let t = 0; t < tris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = tris[t + k];
      const b = tris[t + ((k + 1) % 3)];
      neighbors[a].add(b);
      neighbors[b].add(a);
    }

  /**
   * The welded vertices from a to b along the segment between them (a and b
   * included), or null when no welded path follows the segment
   */
  const chain = (a: number, b: number): number[] | null => {
    if (neighbors[a].has(b)) return [a, b];
    const ax = v[a * 3];
    const ay = v[a * 3 + 1];
    const az = v[a * 3 + 2];
    const dx = v[b * 3] - ax;
    const dy = v[b * 3 + 1] - ay;
    const dz = v[b * 3 + 2] - az;
    const length = Math.hypot(dx, dy, dz);
    if (length === 0) return null;
    const ux = dx / length;
    const uy = dy / length;
    const uz = dz / length;
    const path = [a];
    let current = a;
    let along = 0;
    for (let step = 0; step < vertexCount && current !== b; step++) {
      let next = -1;
      let nextAlong = Number.POSITIVE_INFINITY;
      for (const m of neighbors[current]) {
        const px = v[m * 3] - ax;
        const py = v[m * 3 + 1] - ay;
        const pz = v[m * 3 + 2] - az;
        const t = px * ux + py * uy + pz * uz;
        if (t <= along + ON_LINE || t > length + ON_LINE) continue;
        const off = Math.hypot(px - t * ux, py - t * uy, pz - t * uz);
        if (off > ON_LINE || t >= nextAlong) continue;
        next = m;
        nextAlong = t;
      }
      if (next < 0) return null;
      path.push(next);
      current = next;
      along = nextAlong;
    }
    return current === b ? path : null;
  };

  // Unit normals of the displayed triangles, from their own positions; a
  // triangle too thin to have a trustworthy normal is marked degenerate
  const p = mesh.positions;
  const normals = new Float64Array(n * 3);
  const degenerate = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ux = p[o + 3] - p[o];
    const uy = p[o + 4] - p[o + 1];
    const uz = p[o + 5] - p[o + 2];
    const wx = p[o + 6] - p[o];
    const wy = p[o + 7] - p[o + 1];
    const wz = p[o + 8] - p[o + 2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const area2 = Math.hypot(nx, ny, nz);
    const longest = Math.max(
      ux * ux + uy * uy + uz * uz,
      wx * wx + wy * wy + wz * wz,
      (wx - ux) ** 2 + (wy - uy) ** 2 + (wz - uz) ** 2,
    );
    if (area2 <= 1e-6 * longest || area2 === 0) {
      degenerate[t] = 1;
      continue;
    }
    normals[t * 3] = nx / area2;
    normals[t * 3 + 1] = ny / area2;
    normals[t * 3 + 2] = nz / area2;
  }

  // Map every displayed edge onto its welded pieces, recording which displayed
  // triangles border each piece
  const pieceKey = (a: number, b: number): number =>
    a < b ? a * vertexCount + b : b * vertexCount + a;
  const borders = new Map<number, number[]>();
  // Per displayed edge: its pieces, or null for an edge with no welded path
  const pieces: (number[] | null)[] = new Array(n * 3).fill(null);
  const ids = [0, 0, 0];
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3;
      ids[k] =
        idOf.get(`${snap(p[o])},${snap(p[o + 1])},${snap(p[o + 2])}`) ?? -1;
    }
    // A triangle that collapsed in the weld borders nothing
    if (ids[0] < 0 || ids[1] < 0 || ids[2] < 0) continue;
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
    for (let k = 0; k < 3; k++) {
      // The edge opposite vertex k joins the other two
      const path = chain(ids[(k + 1) % 3], ids[(k + 2) % 3]);
      if (!path) continue;
      const keys: number[] = [];
      for (let i = 0; i + 1 < path.length; i++) {
        const key = pieceKey(path[i], path[i + 1]);
        keys.push(key);
        const list = borders.get(key);
        if (list) list.push(t);
        else borders.set(key, [t]);
      }
      pieces[t * 3 + k] = keys;
    }
  }

  const cosCrease = Math.cos((CREASE_DEGREES * Math.PI) / 180);
  const isCrease = (key: number): boolean => {
    const list = borders.get(key) ?? [];
    // An open boundary or a non-manifold edge is always worth seeing
    if (list.length !== 2) return true;
    const [s, t] = list;
    // A sliver's normal is noise; let the solid faces around it decide
    if (degenerate[s] || degenerate[t]) return false;
    const dot =
      normals[s * 3] * normals[t * 3] +
      normals[s * 3 + 1] * normals[t * 3 + 1] +
      normals[s * 3 + 2] * normals[t * 3 + 2];
    return dot < cosCrease;
  };

  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const keys = pieces[t * 3 + k];
      // Draw the edge only when it is a crease along its whole length. A
      // long edge can run partly along a crease (a hole's rim) and partly
      // across a flat face; the triangle across the crease part draws that
      // part with its own, matching edge. No welded path at all reads as an
      // open boundary, which is drawn
      const crease = keys ? keys.every(isCrease) : !degenerate[t];
      if (!crease) continue;
      for (let vtx = 0; vtx < 3; vtx++) flags[t * 9 + vtx * 3 + k] = 1;
    }
  }
  return flags;
};
