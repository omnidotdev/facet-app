import { describe, expect, test } from "bun:test";

import { buildImportSnippet, normalizePathData } from "./importArt";
import { collectSubpaths } from "./svgPath";

/**
 * Pure tests for the art-import normalizer: any SVG/path/traced `d` is scaled to
 * a sensible size and centered, keeping Y down so `importSvg` flips it upright.
 * The raster decode (canvas -> ImageData) is browser-only and lives in the UI.
 */

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

describe("normalizePathData", () => {
  test("scales a large path down to about the target size", () => {
    // a 400x200 rectangle path
    const big = "M0 0 L400 0 L400 200 L0 200 Z";
    const d = normalizePathData(big, 40);
    const b = bounds(d);
    // longest side ~= target (40)
    expect(b.maxX - b.minX).toBeCloseTo(40, 0);
    expect(b.maxY - b.minY).toBeCloseTo(20, 0);
  });

  test("centers the art on the origin", () => {
    const d = normalizePathData("M10 10 L30 10 L30 30 L10 30 Z", 40);
    const b = bounds(d);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 5);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(0, 5);
  });

  test("accepts a full <svg> document and preserves holes", () => {
    const svg = `<svg><rect x="0" y="0" width="100" height="100"/><rect x="25" y="25" width="50" height="50"/></svg>`;
    const d = normalizePathData(svg, 40);
    expect(collectSubpaths(d).length).toBe(2);
  });

  test("throws on input with no drawable geometry", () => {
    expect(() => normalizePathData("<svg></svg>", 40)).toThrow();
  });
});

describe("buildImportSnippet", () => {
  test("produces runnable Facet code that extrudes the imported path", () => {
    const code = buildImportSnippet("M0 0 L10 0 L10 10 Z", "scorpio.svg");
    expect(code).toContain("importSvg(");
    expect(code).toContain("extrude(");
    expect(code).toContain("return ");
    // the source is noted as a comment, not left as a dangling reference
    expect(code).toContain("scorpio.svg");
  });

  test("embeds the path as a safe string literal (no unescaped quotes)", () => {
    const code = buildImportSnippet('M0 0 L1 0 Z"; dropTable()', "x");
    // the injected quote must be escaped so it cannot break out of the literal
    expect(code).not.toContain('Z"; dropTable()');
  });
});
