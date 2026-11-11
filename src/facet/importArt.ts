/**
 * Turn imported art (an SVG document, a bare path `d`, or a traced raster path)
 * into a clean, runnable Facet snippet. The path is flattened via
 * `collectSubpaths`, scaled to a sensible size and centered on the origin (Y kept
 * down so `importSvg` flips it upright), then emitted as a single normalized
 * polyline `d`. Emitting a normalized polyline is lossless relative to the kernel,
 * which flattens curves to polylines anyway, and lets the import control the size
 * precisely instead of leaving the user with raw document coordinates.
 */

import { collectSubpaths } from "./svgPath";

/** Default longest-side size (mm) an imported part is scaled to. */
const DEFAULT_IMPORT_SIZE = 40;

/** Round to 2 decimals and drop trailing zeros for a compact literal. */
const r2 = (n: number): string => Number.parseFloat(n.toFixed(2)).toString();

/**
 * Normalize SVG/path art to a centered, size-bounded polyline `d` string. Throws
 * when the input has no drawable region.
 */
export function normalizePathData(
  input: string,
  targetSize = DEFAULT_IMPORT_SIZE,
): string {
  const subs = collectSubpaths(input);
  if (subs.length === 0)
    throw new Error("That art has no drawable outline to import.");

  const pts = subs.flat();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const span = Math.max(w, h) || 1;
  const scale = targetSize / span;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Keep Y down (do NOT flip here): importSvg flips Y, so a y-down path reads
  // upright in Facet, matching how a normal SVG viewer shows it
  return subs
    .map((ring) => {
      const head = ring[0];
      const move = `M${r2((head[0] - cx) * scale)} ${r2((head[1] - cy) * scale)}`;
      const lines = ring
        .slice(1)
        .map(([x, y]) => `L${r2((x - cx) * scale)} ${r2((y - cy) * scale)}`)
        .join("");
      return `${move}${lines}Z`;
    })
    .join("");
}

/** Escape a string for embedding inside a double-quoted JS/TS literal. */
const toLiteral = (s: string): string =>
  `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Build a runnable Facet snippet that extrudes a normalized art `d` string, with
 * a thickness parameter and the source noted as a comment.
 */
export function buildImportSnippet(
  normalizedD: string,
  source: string,
): string {
  // Comment-safe source label: strip newlines and close-comment sequences
  const label = source.replace(/\*\//g, "*​/").replace(/[\r\n]+/g, " ");
  return `// Imported from ${label}
const thickness = param.number("thickness", { min: 1, max: 20, default: 4, step: 0.5 });
const art = ${toLiteral(normalizedD)};
return extrude(importSvg(art), thickness);
`;
}
