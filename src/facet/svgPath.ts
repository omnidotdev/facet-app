/**
 * Parse an SVG path `d` string into a replicad 2D `Drawing`.
 *
 * Curves (C/S/Q/T/A) are flattened to line segments here rather than handed to
 * replicad's curve pen: feeding a complex glyph's beziers to replicad directly
 * produced self-touching artifacts, while a dense polyline is robust and, at a
 * glyph's scale, visually identical. The SVG Y axis (down) is negated to CAD
 * (up) so art reads upright, and subpaths that wind the opposite way to the
 * outer contour are cut as holes (letter counters, ring interiors).
 *
 * Supported commands: M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z (absolute and
 * relative). The result is a flat `Drawing` the kernel extrudes or revolves.
 */

import type { Drawing } from "replicad";

type Rc = typeof import("replicad");
type Pt = [number, number];

/** Segments per flattened curve. 24 is smooth at a glyph's ~100-unit scale. */
const CURVE_SEGMENTS = 24;

/** A parsed subpath as a flat polyline (SVG space, pre Y-flip). */
interface SubPath {
  points: Pt[];
}

/** Split a path `d` string into command letters and numeric arguments. */
function tokenize(d: string): { cmd: string; args: number[] }[] {
  const out: { cmd: string; args: number[] }[] = [];
  // A command letter, or a number (incl. scientific notation and compact forms
  // like "1-2" or ".5.5")
  const re =
    /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)/g;
  let current: { cmd: string; args: number[] } | null = null;
  let match: RegExpExecArray | null = re.exec(d);
  while (match !== null) {
    if (match[1]) {
      current = { cmd: match[1], args: [] };
      out.push(current);
    } else if (current) {
      current.args.push(Number.parseFloat(match[2]));
    }
    match = re.exec(d);
  }
  return out;
}

/** Numeric args each command consumes per repetition. */
const ARITY: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

/** Signed area of a 2D ring (shoelace); positive is counter-clockwise. */
function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Sample a cubic bezier from p0 to p3 (exclusive of p0), appending to `out`. */
function flattenCubic(p0: Pt, c1: Pt, c2: Pt, p3: Pt, out: Pt[]): void {
  for (let i = 1; i <= CURVE_SEGMENTS; i++) {
    const t = i / CURVE_SEGMENTS;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push([
      a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0],
      a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1],
    ]);
  }
}

/** Sample a quadratic bezier from p0 to p2 (exclusive of p0). */
function flattenQuad(p0: Pt, c: Pt, p2: Pt, out: Pt[]): void {
  for (let i = 1; i <= CURVE_SEGMENTS; i++) {
    const t = i / CURVE_SEGMENTS;
    const u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1],
    ]);
  }
}

/**
 * Sample an SVG elliptical arc (endpoint parameterization, SVG spec F.6.5) from
 * the current point `p0` to `p1`, appending points (exclusive of p0).
 */
function flattenArc(
  p0: Pt,
  rxIn: number,
  ryIn: number,
  rotDeg: number,
  large: boolean,
  sweep: boolean,
  p1: Pt,
  out: Pt[],
): void {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) {
    out.push(p1);
    return;
  }
  const phi = (rotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  // Scale radii up if they can't span the endpoints
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * (rx * y1p)) / ry;
  const cyp = (co * -(ry * x1p)) / rx;
  const cx = cosP * cxp - sinP * cyp + (p0[0] + p1[0]) / 2;
  const cy = sinP * cxp + cosP * cyp + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta0 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = ang(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  for (let i = 1; i <= CURVE_SEGMENTS; i++) {
    const t = theta0 + (dTheta * i) / CURVE_SEGMENTS;
    const ex = cosP * rx * Math.cos(t) - sinP * ry * Math.sin(t) + cx;
    const ey = sinP * rx * Math.cos(t) + cosP * ry * Math.sin(t) + cy;
    out.push([ex, ey]);
  }
}

/** Parse the path into subpaths of absolute, flattened polylines (SVG space). */
function parse(d: string): SubPath[] {
  const subpaths: SubPath[] = [];
  let pts: Pt[] | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCubicCtrl: Pt | null = null;
  let lastQuadCtrl: Pt | null = null;

  const open = (x: number, y: number): Pt[] => {
    pts = [[x, y]];
    subpaths.push({ points: pts });
    sx = x;
    sy = y;
    return pts;
  };
  const cur = (): Pt[] => pts ?? open(cx, cy);

  for (const { cmd, args } of tokenize(d)) {
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const n = ARITY[upper];

    if (upper === "Z") {
      cx = sx;
      cy = sy;
      lastCubicCtrl = lastQuadCtrl = null;
      pts = null;
      continue;
    }

    const step = n;
    for (let i = 0; i + step <= args.length; i += step) {
      const a = args.slice(i, i + step);
      if (upper === "M") {
        const x = rel ? cx + a[0] : a[0];
        const y = rel ? cy + a[1] : a[1];
        if (i === 0) open(x, y);
        else cur().push([x, y]);
        cx = x;
        cy = y;
        lastCubicCtrl = lastQuadCtrl = null;
      } else if (upper === "L") {
        cx = rel ? cx + a[0] : a[0];
        cy = rel ? cy + a[1] : a[1];
        cur().push([cx, cy]);
        lastCubicCtrl = lastQuadCtrl = null;
      } else if (upper === "H") {
        cx = rel ? cx + a[0] : a[0];
        cur().push([cx, cy]);
        lastCubicCtrl = lastQuadCtrl = null;
      } else if (upper === "V") {
        cy = rel ? cy + a[0] : a[0];
        cur().push([cx, cy]);
        lastCubicCtrl = lastQuadCtrl = null;
      } else if (upper === "C" || upper === "S") {
        let c1x: number;
        let c1y: number;
        if (upper === "C") {
          c1x = rel ? cx + a[0] : a[0];
          c1y = rel ? cy + a[1] : a[1];
        } else {
          c1x = lastCubicCtrl ? 2 * cx - lastCubicCtrl[0] : cx;
          c1y = lastCubicCtrl ? 2 * cy - lastCubicCtrl[1] : cy;
        }
        const o = upper === "C" ? 2 : 0;
        const c2x = rel ? cx + a[o] : a[o];
        const c2y = rel ? cy + a[o + 1] : a[o + 1];
        const ex = rel ? cx + a[o + 2] : a[o + 2];
        const ey = rel ? cy + a[o + 3] : a[o + 3];
        flattenCubic([cx, cy], [c1x, c1y], [c2x, c2y], [ex, ey], cur());
        lastCubicCtrl = [c2x, c2y];
        lastQuadCtrl = null;
        cx = ex;
        cy = ey;
      } else if (upper === "Q" || upper === "T") {
        let qx: number;
        let qy: number;
        if (upper === "Q") {
          qx = rel ? cx + a[0] : a[0];
          qy = rel ? cy + a[1] : a[1];
        } else {
          qx = lastQuadCtrl ? 2 * cx - lastQuadCtrl[0] : cx;
          qy = lastQuadCtrl ? 2 * cy - lastQuadCtrl[1] : cy;
        }
        const o = upper === "Q" ? 2 : 0;
        const ex = rel ? cx + a[o] : a[o];
        const ey = rel ? cy + a[o + 1] : a[o + 1];
        flattenQuad([cx, cy], [qx, qy], [ex, ey], cur());
        lastQuadCtrl = [qx, qy];
        lastCubicCtrl = null;
        cx = ex;
        cy = ey;
      } else if (upper === "A") {
        const ex = rel ? cx + a[5] : a[5];
        const ey = rel ? cy + a[6] : a[6];
        flattenArc(
          [cx, cy],
          a[0],
          a[1],
          a[2],
          a[3] !== 0,
          a[4] !== 0,
          [ex, ey],
          cur(),
        );
        lastCubicCtrl = lastQuadCtrl = null;
        cx = ex;
        cy = ey;
      }
    }
  }
  // Drop any subpath too small to form a region
  return subpaths.filter((s) => s.points.length >= 3);
}

/**
 * Build a replicad `Drawing` from an SVG path `d` string. Throws when the path
 * yields no drawable region.
 */
export function drawSvgPath(rc: Rc, d: string): Drawing {
  const subpaths = parse(d);
  if (subpaths.length === 0)
    throw new Error("The SVG path has no drawable segments.");

  const built = subpaths.map((s) => {
    // Flip Y (SVG down -> CAD up) as we hand points to the pen
    const flipped: Pt[] = s.points.map(([x, y]) => [x, -y]);
    let pen = rc.draw(flipped[0]);
    for (let i = 1; i < flipped.length; i++) pen = pen.lineTo(flipped[i]);
    return { drawing: pen.close(), area: signedArea(flipped) };
  });

  // Largest-area subpath is the outer contour; its winding sign defines "solid".
  // Opposite-sign subpaths are holes (cut); same-sign ones are extra solids
  // (fuse). This matches the common nonzero fill of glyphs and icons
  built.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  const outerSign = Math.sign(built[0].area) || 1;
  let result = built[0].drawing;
  for (let i = 1; i < built.length; i++) {
    const part = built[i];
    result =
      Math.sign(part.area) === outerSign
        ? result.fuse(part.drawing)
        : result.cut(part.drawing);
  }
  return result;
}
