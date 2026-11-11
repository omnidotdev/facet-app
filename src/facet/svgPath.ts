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

// --- Full-SVG ingestion ------------------------------------------------------
// Beyond a bare path `d`, accept a whole <svg> document: every <path> plus the
// basic shapes (<rect>/<circle>/<ellipse>/<line>/<polyline>/<polygon>), with
// element and nested-group `transform` attributes baked into the coordinates.
// `viewBox`, CSS/`style`, `<use>`, gradients and text are not interpreted; the
// authored user-space coordinates are used as-is (scale in Facet as needed).

/** A 2D affine transform as the SVG [a, b, c, d, e, f] tuple. */
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** Compose two affine transforms so `compose(m, n)` applies n then m to a point. */
function compose(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Apply an affine transform to a point. */
function applyMat(m: Mat, [x, y]: Pt): Pt {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Parse an SVG `transform` attribute (a list of functions) into one matrix. */
function parseTransform(value: string): Mat {
  let acc: Mat = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null = re.exec(value);
  while (m !== null) {
    const name = m[1];
    const a = m[2]
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number);
    let t: Mat = IDENTITY;
    if (name === "translate") t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (name === "scale") t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (name === "matrix" && a.length === 6)
      t = [a[0], a[1], a[2], a[3], a[4], a[5]];
    else if (name === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      const rot: Mat = [cos, sin, -sin, cos, 0, 0];
      if (a.length >= 3) {
        const cx = a[1];
        const cy = a[2];
        t = compose(compose([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy]);
      } else t = rot;
    } else if (name === "skewX")
      t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (name === "skewY")
      t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    acc = compose(acc, t);
    m = re.exec(value);
  }
  return acc;
}

/** Read an attribute's value from a tag's attribute text (double or single quoted). */
function attr(attrs: string, name: string): string | null {
  const m = attrs.match(
    new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"),
  );
  return m ? (m[2] ?? m[3] ?? "") : null;
}

/** Numeric attribute, defaulting to 0 (or a given fallback). */
function num(attrs: string, name: string, fallback = 0): number {
  const v = attr(attrs, name);
  if (v === null) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Convert a basic shape element to an equivalent path `d`, or null if unsupported. */
function shapeToPathData(tag: string, attrs: string): string | null {
  switch (tag) {
    case "path":
      return attr(attrs, "d");
    case "rect": {
      const x = num(attrs, "x");
      const y = num(attrs, "y");
      const w = num(attrs, "width");
      const h = num(attrs, "height");
      if (w <= 0 || h <= 0) return null;
      // Corner radii are ignored (sharp corners); adequate for icon import
      return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
    }
    case "circle": {
      const cx = num(attrs, "cx");
      const cy = num(attrs, "cy");
      const r = num(attrs, "r");
      if (r <= 0) return null;
      return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
    }
    case "ellipse": {
      const cx = num(attrs, "cx");
      const cy = num(attrs, "cy");
      const rx = num(attrs, "rx");
      const ry = num(attrs, "ry");
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case "line": {
      // A zero-area segment: kept for completeness, dropped later for want of a region
      const x1 = num(attrs, "x1");
      const y1 = num(attrs, "y1");
      const x2 = num(attrs, "x2");
      const y2 = num(attrs, "y2");
      return `M${x1} ${y1}L${x2} ${y2}`;
    }
    case "polyline":
    case "polygon": {
      const raw = attr(attrs, "points");
      if (!raw) return null;
      const nums = raw
        .split(/[\s,]+/)
        .filter((s) => s.length > 0)
        .map(Number);
      if (nums.length < 4) return null;
      let d = `M${nums[0]} ${nums[1]}`;
      for (let i = 2; i + 1 < nums.length; i += 2)
        d += `L${nums[i]} ${nums[i + 1]}`;
      return tag === "polygon" ? `${d}Z` : d;
    }
    default:
      return null;
  }
}

/**
 * Walk an SVG document, baking each element's (and its ancestor groups')
 * transform into flattened, absolute polylines in SVG space.
 */
function parseSvgDocument(svg: string): Pt[][] {
  const out: Pt[][] = [];
  const stack: Mat[] = [IDENTITY];
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null = tagRe.exec(svg);
  while (m !== null) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3];
    const selfClose = m[4] === "/";
    const isContainer = tag === "g" || tag === "svg";

    if (closing) {
      if (isContainer && stack.length > 1) stack.pop();
    } else {
      const own = (() => {
        const tv = attr(attrs, "transform");
        return tv ? parseTransform(tv) : IDENTITY;
      })();
      const cumulative = compose(stack[stack.length - 1], own);
      if (isContainer) {
        if (!selfClose) stack.push(cumulative);
      } else {
        const d = shapeToPathData(tag, attrs);
        if (d) {
          for (const sp of parse(d))
            out.push(sp.points.map((p) => applyMat(cumulative, p)));
        }
      }
    }
    m = tagRe.exec(svg);
  }
  return out;
}

/**
 * Turn either a bare path `d` string or a full `<svg>` document into flattened,
 * absolute, transform-baked polylines in SVG space (Y still points down). The
 * entry point both the kernel and tests use; exported so the ingestion can be
 * exercised without the B-rep kernel.
 */
export function collectSubpaths(input: string): Pt[][] {
  if (!input.trimStart().startsWith("<"))
    return parse(input).map((s) => s.points);
  return parseSvgDocument(input);
}

/**
 * Build a replicad `Drawing` from an SVG path `d` string OR a whole `<svg>`
 * document. Throws when the input yields no drawable region.
 */
export function drawSvgPath(rc: Rc, d: string): Drawing {
  const polys = collectSubpaths(d);
  if (polys.length === 0)
    throw new Error("The SVG path has no drawable segments.");

  const built = polys.map((points) => {
    // Flip Y (SVG down -> CAD up) as we hand points to the pen
    const flipped: Pt[] = points.map(([x, y]) => [x, -y]);
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
