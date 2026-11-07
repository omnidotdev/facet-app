/**
 * Parse an SVG path `d` string into a replicad 2D `Drawing`.
 *
 * The SVG coordinate system has +Y pointing down; CAD (and replicad) has +Y up,
 * so every Y is negated here to keep a glyph upright. Each subpath becomes its
 * own closed drawing; subpaths that wind the opposite way to the outer contour
 * are treated as holes and cut out (so letter counters and ring interiors read
 * correctly), and same-winding subpaths are fused (a multi-part glyph).
 *
 * Supported commands: M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z (absolute and
 * relative). This is a profile builder, not a renderer: the result is a flat
 * `Drawing` the kernel extrudes or revolves like any other sketch.
 */

import type { Drawing } from "replicad";

type Rc = typeof import("replicad");
type Pt = [number, number];

/** The slice of replicad's pen surface this builder uses. */
interface PenLike {
  lineTo(p: Pt): PenLike;
  cubicBezierCurveTo(end: Pt, startControl: Pt, endControl: Pt): PenLike;
  bezierCurveTo(end: Pt, controlPoints: Pt): PenLike;
  ellipseTo(
    end: Pt,
    rx: number,
    ry: number,
    rotation: number,
    longAxis: boolean,
    sweep: boolean,
  ): PenLike;
  close(): Drawing;
}

/** A fully-parsed subpath: ordered pen operations plus anchor points (for the
 * signed-area winding test). */
interface SubPath {
  start: Pt;
  ops: ((pen: PenLike) => PenLike)[];
  anchors: Pt[];
}

/** Split a path `d` string into its command letters and numeric arguments. */
function tokenize(d: string): { cmd: string; args: number[] }[] {
  const out: { cmd: string; args: number[] }[] = [];
  // A command letter, or a number (incl. scientific notation and the compact
  // SVG forms like "1-2" or ".5.5")
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

/** Signed area of a polygon (shoelace); positive is counter-clockwise. */
function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Parse the path into subpaths of absolute, Y-flipped pen operations. */
function parse(d: string): SubPath[] {
  const subpaths: SubPath[] = [];
  let sub: SubPath | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCubicCtrl: Pt | null = null;
  let lastQuadCtrl: Pt | null = null;

  const P = (x: number, y: number): Pt => [x, -y]; // SVG -> CAD (flip Y)

  const startSub = (x: number, y: number): SubPath => {
    const s: SubPath = { start: P(x, y), ops: [], anchors: [P(x, y)] };
    subpaths.push(s);
    sub = s;
    sx = x;
    sy = y;
    return s;
  };
  // The current subpath, starting one at the current point if a segment command
  // appears before any moveto (tolerant of malformed paths)
  const cur = (): SubPath => sub ?? startSub(cx, cy);
  const emit = (op: (pen: PenLike) => PenLike, anchor: Pt): void => {
    const s = cur();
    s.ops.push(op);
    s.anchors.push(anchor);
  };

  for (const { cmd, args } of tokenize(d)) {
    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const n = ARITY[upper];

    if (upper === "Z") {
      cx = sx;
      cy = sy;
      lastCubicCtrl = lastQuadCtrl = null;
      sub = null;
      continue;
    }

    // Commands repeat when given extra coordinate sets; an extra M repeats as L
    const step = n;
    for (let i = 0; i + step <= args.length; i += step) {
      const a = args.slice(i, i + step);
      if (upper === "M") {
        const x = rel ? cx + a[0] : a[0];
        const y = rel ? cy + a[1] : a[1];
        if (i === 0) startSub(x, y);
        else emit((pen) => pen.lineTo(P(x, y)), P(x, y));
        cx = x;
        cy = y;
        lastCubicCtrl = lastQuadCtrl = null;
      } else if (upper === "L") {
        const x = rel ? cx + a[0] : a[0];
        const y = rel ? cy + a[1] : a[1];
        emit((pen) => pen.lineTo(P(x, y)), P(x, y));
        cx = x;
        cy = y;
        lastCubicCtrl = lastQuadCtrl = null;
      } else if (upper === "H") {
        const x = rel ? cx + a[0] : a[0];
        emit((pen) => pen.lineTo(P(x, cy)), P(x, cy));
        cx = x;
        lastCubicCtrl = lastQuadCtrl = null;
      } else if (upper === "V") {
        const y = rel ? cy + a[0] : a[0];
        emit((pen) => pen.lineTo(P(cx, y)), P(cx, y));
        cy = y;
        lastCubicCtrl = lastQuadCtrl = null;
      } else if (upper === "C" || upper === "S") {
        let c1x: number;
        let c1y: number;
        if (upper === "C") {
          c1x = rel ? cx + a[0] : a[0];
          c1y = rel ? cy + a[1] : a[1];
        } else {
          // S: first control reflects the previous cubic control
          c1x = lastCubicCtrl ? 2 * cx - lastCubicCtrl[0] : cx;
          c1y = lastCubicCtrl ? 2 * cy - lastCubicCtrl[1] : cy;
        }
        const o = upper === "C" ? 2 : 0;
        const c2x = rel ? cx + a[o] : a[o];
        const c2y = rel ? cy + a[o + 1] : a[o + 1];
        const ex = rel ? cx + a[o + 2] : a[o + 2];
        const ey = rel ? cy + a[o + 3] : a[o + 3];
        emit(
          (pen) => pen.cubicBezierCurveTo(P(ex, ey), P(c1x, c1y), P(c2x, c2y)),
          P(ex, ey),
        );
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
        emit((pen) => pen.bezierCurveTo(P(ex, ey), P(qx, qy)), P(ex, ey));
        lastQuadCtrl = [qx, qy];
        lastCubicCtrl = null;
        cx = ex;
        cy = ey;
      } else if (upper === "A") {
        const rx = a[0];
        const ry = a[1];
        const rot = a[2];
        const large = a[3] !== 0;
        const sweep = a[4] !== 0;
        const ex = rel ? cx + a[5] : a[5];
        const ey = rel ? cy + a[6] : a[6];
        // Reflecting across Y inverts the sweep direction and negates rotation
        emit(
          (pen) => pen.ellipseTo(P(ex, ey), rx, ry, -rot, large, !sweep),
          P(ex, ey),
        );
        lastCubicCtrl = lastQuadCtrl = null;
        cx = ex;
        cy = ey;
      }
    }
  }
  return subpaths.filter((s) => s.ops.length > 0);
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
    let pen = rc.draw(s.start) as unknown as PenLike;
    for (const op of s.ops) pen = op(pen);
    return { drawing: pen.close(), area: signedArea(s.anchors) };
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
