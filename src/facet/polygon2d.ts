/**
 * Polygon fast path for 2D booleans, used for live previews while a slider is
 * dragged. The exact path merges sketches with replicad's curve booleans, which
 * cost hundreds of milliseconds on a part built from many small pieces (a
 * generated glyph unions ~150 of them). Here every piece becomes a polygon and
 * one polygon-clipping call merges them all in a few milliseconds. Circles are
 * flattened at the same tolerances the display mesh uses, so the preview looks
 * like the exact part; the exact path still runs once the drag ends, and it is
 * the only path exports use.
 */

import polygonClipping from "polygon-clipping";

import type { MultiPolygon, Ring } from "polygon-clipping";
import type { OpNode } from "./opgraph";

const DEG_TO_RAD = Math.PI / 180;

/** Matches the exact kernel: up to this many segments a circle is a polygon */
const EXPLICIT_POLYGON_MAX_SEGMENTS = 12;

const BOOLEAN_OPS = new Set(["union2d", "difference2d", "intersect2d"]);

/** True for a 2D boolean, the op worth replacing in a preview */
export const is2dBoolean = (node: OpNode): boolean => BOOLEAN_OPS.has(node.op);

/** Segment count that keeps a circle within the display mesh tolerances */
export const circleSegments = (
  r: number,
  chordTolerance: number,
  angularTolerance: number,
): number => {
  const byAngle = Math.ceil((2 * Math.PI) / angularTolerance);
  const ratio = 1 - chordTolerance / Math.max(r, chordTolerance);
  const byChord = ratio > -1 ? Math.ceil(Math.PI / Math.acos(ratio)) : 3;
  return Math.min(256, Math.max(8, byAngle, byChord));
};

const mapRings = (
  shape: MultiPolygon,
  fn: (x: number, y: number) => [number, number],
): MultiPolygon =>
  shape.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => fn(x, y))));

/** A mirror reverses winding; restore it so the clipper sees valid rings */
const reverseRings = (shape: MultiPolygon): MultiPolygon =>
  shape.map((polygon) => polygon.map((ring) => [...ring].reverse()));

export interface PolygonizeOptions {
  chordTolerance: number;
  angularTolerance: number;
}

/**
 * Flatten a 2D subtree into polygons, or null when it holds a piece with no
 * polygon form here (SVG paths, text, offsets), so the caller keeps the exact
 * path for it
 */
export function polygonize(
  node: OpNode,
  options: PolygonizeOptions,
): MultiPolygon | null {
  switch (node.op) {
    case "circle2d": {
      const explicit =
        Number.isFinite(node.segments) &&
        node.segments >= 3 &&
        node.segments <= EXPLICIT_POLYGON_MAX_SEGMENTS;
      const n = explicit
        ? node.segments
        : circleSegments(
            node.r,
            options.chordTolerance,
            options.angularTolerance,
          );
      // Same vertex placement as replicad's drawPolysides, so an explicit
      // hexagon does not rotate when the exact rebuild replaces the preview
      const ring: Ring = [];
      for (let i = 0; i < n; i++) {
        const theta = -((Math.PI * 2) / n) * i;
        ring.push([node.r * Math.sin(theta), node.r * Math.cos(theta)]);
      }
      return [[ring]];
    }
    case "rect2d": {
      const [w, h] = node.size;
      const [x0, y0] = node.center ? [-w / 2, -h / 2] : [0, 0];
      return [
        [
          [
            [x0, y0],
            [x0 + w, y0],
            [x0 + w, y0 + h],
            [x0, y0 + h],
          ],
        ],
      ];
    }
    case "polygon2d": {
      const pts = node.points;
      if (pts.length < 6 || pts.length % 2 !== 0) return null;
      const ring: Ring = [];
      for (let i = 0; i < pts.length; i += 2) ring.push([pts[i], pts[i + 1]]);
      return [[ring]];
    }
    case "translate2d": {
      const child = polygonize(node.child, options);
      const [dx, dy] = node.v;
      return child && mapRings(child, (x, y) => [x + dx, y + dy]);
    }
    case "rotate2d": {
      const child = polygonize(node.child, options);
      const c = Math.cos(node.angle * DEG_TO_RAD);
      const s = Math.sin(node.angle * DEG_TO_RAD);
      return child && mapRings(child, (x, y) => [x * c - y * s, x * s + y * c]);
    }
    case "scale2d": {
      const child = polygonize(node.child, options);
      const k = node.factor;
      if (!child) return null;
      const scaled = mapRings(child, (x, y) => [x * k, y * k]);
      return k < 0 ? reverseRings(scaled) : scaled;
    }
    case "mirror2d": {
      const child = polygonize(node.child, options);
      const [nx, ny] = node.normal;
      const len = Math.hypot(nx, ny);
      if (!child || len === 0) return null;
      const ux = nx / len;
      const uy = ny / len;
      // Reflect across the line through the origin whose normal is (ux, uy)
      return reverseRings(
        mapRings(child, (x, y) => {
          const d = 2 * (x * ux + y * uy);
          return [x - d * ux, y - d * uy];
        }),
      );
    }
    case "union2d":
    case "difference2d":
    case "intersect2d": {
      // Repeated a = a.union(b) nests unions hundreds deep; gather the leaves
      // so one clipper call merges them all
      const children =
        node.op === "union2d" ? flattenUnions(node) : node.children;
      const parts: MultiPolygon[] = [];
      for (const child of children) {
        const part = polygonize(child, options);
        if (!part) return null;
        parts.push(part);
      }
      if (!parts.length) return null;
      const [first, ...rest] = parts;
      if (!rest.length) return first;
      // One n-ary call per op, so the clipper sweeps every piece together
      if (node.op === "union2d") return polygonClipping.union(first, ...rest);
      if (node.op === "difference2d")
        return polygonClipping.difference(first, ...rest);
      return polygonClipping.intersection(first, ...rest);
    }
    default:
      return null;
  }
}

/** The leaves of a chain of nested unions, in order */
function flattenUnions(node: OpNode): OpNode[] {
  const leaves: OpNode[] = [];
  const visit = (child: OpNode) => {
    if (child.op === "union2d") child.children.forEach(visit);
    else leaves.push(child);
  };
  visit(node);
  return leaves;
}
