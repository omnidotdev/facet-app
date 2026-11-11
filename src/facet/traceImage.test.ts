import { describe, expect, test } from "bun:test";

import { collectSubpaths } from "./svgPath";
import { traceImageData } from "./traceImage";

import type { RgbaImage } from "./traceImage";

/**
 * Pure (no-DOM) tests for raster vectorization. `traceImageData` turns a bitmap
 * into an SVG path `d` string of closed contours, which flows straight into
 * `collectSubpaths`/`importSvg`. Shapes are described as ASCII for readability.
 */

/** Build an RGBA image from ASCII rows: `#` is opaque ink, anything else is white. */
function fromAscii(rows: string[]): RgbaImage {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x] ?? ".";
      const ink = ch === "#";
      const i = (y * width + x) * 4;
      const v = ink ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Axis-aligned bounds of every traced point. */
function bounds(d: string) {
  const pts = collectSubpaths(d).flat();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    subpaths: collectSubpaths(d).length,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe("traceImageData", () => {
  test("a blank image yields no contour", () => {
    const img = fromAscii(["....", "....", "...."]);
    expect(traceImageData(img).trim()).toBe("");
  });

  test("a solid block traces to one closed contour at its extent", () => {
    // ink occupies columns 1..4, rows 1..2 (a 4x2 block) in a 6x4 image
    const img = fromAscii(["......", ".####.", ".####.", "......"]);
    const d = traceImageData(img);
    const b = bounds(d);
    expect(b.subpaths).toBe(1);
    // the contour hugs the block edges: x in [1,5], y in [1,3]
    expect(b.minX).toBeCloseTo(1, 1);
    expect(b.maxX).toBeCloseTo(5, 1);
    expect(b.minY).toBeCloseTo(1, 1);
    expect(b.maxY).toBeCloseTo(3, 1);
  });

  test("a block with an interior hole traces to two contours (outer + hole)", () => {
    const img = fromAscii([
      "........",
      ".######.",
      ".#....#.",
      ".#....#.",
      ".######.",
      "........",
    ]);
    const subs = collectSubpaths(traceImageData(img));
    expect(subs.length).toBe(2);
  });

  test("two separate blocks trace to two contours", () => {
    const img = fromAscii([
      "..........",
      ".##....##.",
      ".##....##.",
      "..........",
    ]);
    const subs = collectSubpaths(traceImageData(img));
    expect(subs.length).toBe(2);
  });

  test("invert traces the light region instead of the dark", () => {
    // a white cross on black: without invert the black traces; with invert the white does
    const img = fromAscii(["#.#", "...", "#.#"]);
    const normal = collectSubpaths(traceImageData(img)).length;
    const inverted = collectSubpaths(
      traceImageData(img, { invert: true }),
    ).length;
    // the four black corners vs the single white plus-shape: different counts
    expect(normal).not.toBe(inverted);
  });

  test("the output is y-down image space (importSvg flips it upright)", () => {
    // ink only in the TOP row band; in y-down space its y is small
    const img = fromAscii(["####", "####", "....", "...."]);
    const b = bounds(traceImageData(img));
    expect(b.minY).toBeCloseTo(0, 1);
    expect(b.maxY).toBeCloseTo(2, 1);
  });
});
