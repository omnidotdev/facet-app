/**
 * Tessellated sweeps for the mesh/CSG kernel: turn a flat profile ring into a
 * solid by linear extrusion or revolution, so the fast kernel handles the common
 * extrude/revolve cases without the OCCT round-trip. Only simple single-ring
 * profiles (circle/rect/polygon) are tessellated here; curved or combined
 * profiles (svg/text/offset/2D booleans) still route to the B-rep kernel.
 *
 * The orientation matches the B-rep kernel: extrude sketches the profile on XY
 * and sweeps +Z; revolve treats the profile's X as the radius and Y as the
 * height, spun about Z.
 */

import { CSG, Polygon, Vector, Vertex } from "./csg";

import type { OpNode } from "./opgraph";

type Pt = [number, number];
const DEG = Math.PI / 180;

/** Signed area of a 2D ring (shoelace); positive is counter-clockwise. */
function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Is point p inside triangle a,b,c (inclusive)? */
function pointInTri(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const d = (u: Pt, v: Pt, w: Pt) =>
    (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1]);
  const d1 = d(p, a, b);
  const d2 = d(p, b, c);
  const d3 = d(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Ear-clip a simple polygon into triangles, returned as index triples into the
 * input ring. The ring is normalized to CCW internally; indices refer to the
 * original points so callers control winding.
 */
function triangulate(ring: Pt[]): [number, number, number][] {
  const n = ring.length;
  if (n < 3) return [];
  // Work on a CCW index list
  const idx = Array.from({ length: n }, (_, i) => i);
  if (signedArea(ring) < 0) idx.reverse();

  const tris: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = ring[ia];
      const b = ring[ib];
      const c = ring[ic];
      // Convex corner? (CCW winding -> cross > 0)
      const cross =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 0) continue;
      // No other vertex inside the candidate ear
      let hasInside = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (pointInTri(ring[j], a, b, c)) {
          hasInside = true;
          break;
        }
      }
      if (hasInside) continue;
      tris.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate; stop rather than loop forever
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/** Build a flat triangle fan/cap polygon list from a ring of 3D vertices. */
function capPolys(
  points3d: Vector[],
  tris: [number, number, number][],
  normal: Vector,
  flip: boolean,
): Polygon[] {
  return tris.map(([i, j, k]) => {
    const vs = flip ? [k, j, i] : [i, j, k];
    return new Polygon(vs.map((n) => new Vertex(points3d[n], normal)));
  });
}

/**
 * Linear extrude a profile ring from z=0 to z=height, with an optional twist
 * (degrees over the height) and end `scale` (top-face scale). The profile is in
 * the XY plane; the sweep is +Z.
 */
export function extrudeProfileMesh(
  ring: Pt[],
  height: number,
  twist: number,
  scale: number,
): CSG {
  if (ring.length < 3)
    throw new Error("extrude needs a profile with 3+ points");
  const ccw = signedArea(ring) >= 0;
  const tris = triangulate(ring);

  // A twist makes the side walls non-planar, so slice the height into layers
  // small enough (<= ~10 deg each) that each wall quad is near-planar. A pure
  // taper (scale only) keeps planar walls, so one layer suffices
  const layers = twist === 0 ? 1 : Math.max(1, Math.ceil(Math.abs(twist) / 10));
  // Ring at height fraction f in [0,1], interpolating twist and scale
  const ringAt = (f: number): Vector[] => {
    const tw = twist * DEG * f;
    const cos = Math.cos(tw);
    const sin = Math.sin(tw);
    const s = 1 + (scale - 1) * f;
    return ring.map(([x, y]) => {
      const sx = x * s;
      const sy = y * s;
      return new Vector(sx * cos - sy * sin, sx * sin + sy * cos, height * f);
    });
  };

  const levels: Vector[][] = [];
  for (let l = 0; l <= layers; l++) levels.push(ringAt(l / layers));

  const polys: Polygon[] = [];
  // Caps: bottom faces -Z (flip so its normal points down), top faces +Z
  polys.push(...capPolys(levels[0], tris, new Vector(0, 0, -1), ccw));
  polys.push(...capPolys(levels[layers], tris, new Vector(0, 0, 1), !ccw));

  // Side walls per layer: one quad per edge, wound so the normal faces outward
  const n = ring.length;
  for (let l = 0; l < layers; l++) {
    const lower = levels[l];
    const upper = levels[l + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const b0 = lower[i];
      const b1 = lower[j];
      const t0 = upper[i];
      const t1 = upper[j];
      let normal = b1.minus(b0).cross(t0.minus(b0)).unit();
      if (ccw) normal = normal.times(-1);
      const quad = ccw ? [b0, t0, t1, b1] : [b0, b1, t1, t0];
      polys.push(new Polygon(quad.map((p) => new Vertex(p, normal))));
    }
  }
  return CSG.fromPolygons(polys);
}

/**
 * Revolve a profile ring about the Z axis. The profile's X is the radius and its
 * Y the height (as in the B-rep kernel's XZ sketch). `angle` is the sweep in
 * degrees; a partial sweep gets flat end caps.
 */
export function revolveProfileMesh(
  ring: Pt[],
  angle: number,
  segments: number,
): CSG {
  if (ring.length < 3)
    throw new Error("revolve needs a profile with 3+ points");
  const steps = Math.max(3, Math.floor(segments));
  const full = Math.abs(angle % 360) < 1e-6 && angle !== 0;
  const total = (full ? 360 : angle) * DEG;

  // A point at (radius, height) rotated to angle t
  const at = (p: Pt, t: number): Vector =>
    new Vector(p[0] * Math.cos(t), p[0] * Math.sin(t), p[1]);

  const polys: Polygon[] = [];
  const n = ring.length;
  for (let s = 0; s < steps; s++) {
    const t0 = (s / steps) * total;
    const t1 = ((s + 1) / steps) * total;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = at(ring[i], t0);
      const b = at(ring[j], t0);
      const c = at(ring[j], t1);
      const d = at(ring[i], t1);
      // Skip a degenerate quad on the axis (both profile points at radius 0)
      if (ring[i][0] === 0 && ring[j][0] === 0) continue;
      const normal = b.minus(a).cross(d.minus(a)).unit();
      polys.push(new Polygon([a, b, c, d].map((p) => new Vertex(p, normal))));
    }
  }

  // End caps for a partial revolution: the profile face at the start and end
  if (!full) {
    const tris = triangulate(ring);
    const startPts = ring.map((p) => at(p, 0));
    const endPts = ring.map((p) => at(p, total));
    const ccw = signedArea(ring) >= 0;
    // Normals are the plane normals of the two cut faces
    const nStart = new Vector(0, -1, 0);
    const nEnd = new Vector(Math.sin(total), -Math.cos(total), 0).unit();
    polys.push(...capPolys(startPts, tris, nStart, !ccw));
    polys.push(...capPolys(endPts, tris, nEnd, ccw));
  }
  return CSG.fromPolygons(polys);
}

/**
 * A 2D profile ring for a simple sketch primitive, in CCW order, or null when
 * the profile needs the B-rep kernel (curves, offsets, or 2D booleans).
 */
export function profileRing(node: OpNode): Pt[] | null {
  if (node.op === "circle2d") {
    const seg = Math.max(3, Math.floor(node.segments));
    const ring: Pt[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      ring.push([node.r * Math.cos(a), node.r * Math.sin(a)]);
    }
    return ring;
  }
  if (node.op === "rect2d") {
    const [w, h] = node.size;
    if (node.center)
      return [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ];
    return [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
  }
  if (node.op === "polygon2d") {
    const pts = node.points;
    if (pts.length < 6 || pts.length % 2 !== 0) return null;
    const ring: Pt[] = [];
    for (let i = 0; i < pts.length; i += 2) ring.push([pts[i], pts[i + 1]]);
    return ring;
  }
  // A 2D transform recurses into its child ring and maps each point. A simple
  // transformed profile stays tessellatable here; a curved/combined child
  // returns null and routes to B-rep. The math matches the B-rep Drawing
  // methods (origin-centered rotate/scale, reflection across a line through the
  // origin), so the two kernels build the same solid. It also mirrors the Rust
  // sweep: translate/scale/mirror are algebraic and agree with it bit for bit,
  // while rotate's sin/cos match within a floating-point tolerance
  if (node.op === "translate2d") {
    const ring = profileRing(node.child);
    if (!ring) return null;
    const [dx, dy] = node.v;
    return ring.map(([x, y]): Pt => [x + dx, y + dy]);
  }
  if (node.op === "rotate2d") {
    const ring = profileRing(node.child);
    if (!ring) return null;
    const a = node.angle * DEG;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return ring.map(([x, y]): Pt => [x * cos - y * sin, x * sin + y * cos]);
  }
  if (node.op === "scale2d") {
    const ring = profileRing(node.child);
    if (!ring) return null;
    return ring.map(([x, y]): Pt => [x * node.factor, y * node.factor]);
  }
  if (node.op === "mirror2d") {
    const ring = profileRing(node.child);
    if (!ring) return null;
    const [nx, ny] = node.normal;
    // Use a plain sqrt (not Math.hypot) so the length matches the Rust kernel
    // bit for bit: IEEE sqrt is correctly rounded and deterministic across V8
    // and wasm, whereas Math.hypot scales and compensates and can differ by a
    // ULP for a non-axis normal
    const len = Math.sqrt(nx * nx + ny * ny) || 1;
    const ux = nx / len;
    const uy = ny / len;
    const reflected = ring.map(([x, y]): Pt => {
      const d = 2 * (x * ux + y * uy);
      return [x - d * ux, y - d * uy];
    });
    // A reflection flips orientation, so reverse the ring to keep its winding
    reflected.reverse();
    return reflected;
  }
  return null; // svg2d, text2d, offset2d, 2D booleans -> B-rep
}
