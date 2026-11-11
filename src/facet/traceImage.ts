/**
 * Vectorize a raster bitmap into an SVG path `d` string of closed contours, so a
 * PNG/JPG icon or symbol can be extruded. The image is thresholded to a binary
 * ink mask, then the boundary between ink and background is traced along the
 * pixel grid (each ink pixel is a unit cell), producing oriented, axis-aligned
 * polygons. Outer contours and holes come out with opposite winding, which is
 * exactly what `importSvg`/`collectSubpaths` uses to cut holes.
 *
 * Coordinates are in pixel units with Y pointing down (image space); `importSvg`
 * flips Y so the art reads upright. The result is rectilinear (stair-stepped on
 * diagonals), which extrudes cleanly and matches how Facet already flattens SVG
 * art to polylines; scale it down in Facet to the size you want.
 */

/** A minimal RGBA bitmap (matches the shape of a canvas `ImageData`). */
export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8ClampedArray | number[];
}

export interface TraceOptions {
  /** Luminance cutoff 0-255; pixels darker than this are ink (default 128). */
  threshold?: number;
  /** Treat lighter-than-threshold pixels as ink instead (default false). */
  invert?: boolean;
  /** Drop contours enclosing fewer than this many pixel cells (default 2). */
  minArea?: number;
}

type Pt = [number, number];

/** Build the binary ink mask (1 = ink) from the image under the threshold. */
function inkMask(
  img: RgbaImage,
  threshold: number,
  invert: boolean,
): Uint8Array {
  const { width, height, data } = img;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    // A transparent pixel is background regardless of color
    if (a < 128) continue;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const dark = lum < threshold;
    mask[i] = (invert ? !dark : dark) ? 1 : 0;
  }
  return mask;
}

/** Shoelace signed area of a ring. */
function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Drop interior points that are collinear with their neighbors. */
function mergeCollinear(pts: Pt[]): Pt[] {
  const n = pts.length;
  if (n <= 2) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross !== 0) out.push(b);
  }
  return out.length >= 3 ? out : pts;
}

const key = (x: number, y: number): string => `${x},${y}`;

/**
 * Trace all ink/background boundary loops. Each ink cell contributes a directed
 * edge per side whose neighbor is background, oriented CCW around the cell, so
 * walking the directed edges yields closed, consistently wound loops.
 */
function traceLoops(mask: Uint8Array, width: number, height: number): Pt[][] {
  const ink = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  // Directed boundary edges (CCW around each ink cell)
  const edges: { from: Pt; to: Pt }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!ink(x, y)) continue;
      // cell square corners: (x,y) top-left .. (x+1,y+1) bottom-right in y-down
      if (!ink(x, y - 1)) edges.push({ from: [x + 1, y], to: [x, y] }); // top edge
      if (!ink(x + 1, y)) edges.push({ from: [x + 1, y + 1], to: [x + 1, y] }); // right
      if (!ink(x, y + 1)) edges.push({ from: [x, y + 1], to: [x + 1, y + 1] }); // bottom
      if (!ink(x - 1, y)) edges.push({ from: [x, y], to: [x, y + 1] }); // left
    }
  }

  // Index unused out-edges by their start vertex
  const byStart = new Map<string, number[]>();
  edges.forEach((e, i) => {
    const k = key(e.from[0], e.from[1]);
    const list = byStart.get(k);
    if (list) list.push(i);
    else byStart.set(k, [i]);
  });
  const used = new Array<boolean>(edges.length).fill(false);

  const takeNext = (fromKey: string, inDir: Pt): number => {
    const cands = (byStart.get(fromKey) ?? []).filter((i) => !used[i]);
    if (cands.length === 0) return -1;
    if (cands.length === 1) return cands[0];
    // At a diagonal pinch, keep hugging the boundary: prefer the sharpest
    // clockwise turn (right-hand wall follow), which separates touching corners
    let best = cands[0];
    let bestTurn = Number.POSITIVE_INFINITY;
    for (const i of cands) {
      const e = edges[i];
      const outDir: Pt = [e.to[0] - e.from[0], e.to[1] - e.from[1]];
      // cross>0 is a left turn in y-down; minimize (most clockwise) via angle
      const cross = inDir[0] * outDir[1] - inDir[1] * outDir[0];
      const dot = inDir[0] * outDir[0] + inDir[1] * outDir[1];
      const turn = Math.atan2(cross, dot); // (-pi, pi]
      if (turn < bestTurn) {
        bestTurn = turn;
        best = i;
      }
    }
    return best;
  };

  const loops: Pt[][] = [];
  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    const loop: Pt[] = [];
    let idx = s;
    let guard = 0;
    const limit = edges.length + 4;
    while (idx !== -1 && !used[idx] && guard++ < limit) {
      used[idx] = true;
      const e = edges[idx];
      loop.push([e.from[0], e.from[1]]);
      const inDir: Pt = [e.to[0] - e.from[0], e.to[1] - e.from[1]];
      idx = takeNext(key(e.to[0], e.to[1]), inDir);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * Trace a bitmap to an SVG path `d` string of closed contours (holes included),
 * or an empty string when the image has no ink. Feed the result to `importSvg`.
 */
export function traceImageData(
  img: RgbaImage,
  opts: TraceOptions = {},
): string {
  const threshold = opts.threshold ?? 128;
  const minArea = opts.minArea ?? 2;
  const mask = inkMask(img, threshold, opts.invert ?? false);

  const loops = traceLoops(mask, img.width, img.height)
    .map(mergeCollinear)
    .filter((l) => Math.abs(signedArea(l)) >= minArea);

  if (loops.length === 0) return "";

  return loops
    .map((loop) => {
      const head = `M${loop[0][0]} ${loop[0][1]}`;
      const rest = loop
        .slice(1)
        .map(([x, y]) => `L${x} ${y}`)
        .join("");
      return `${head}${rest}Z`;
    })
    .join("");
}
