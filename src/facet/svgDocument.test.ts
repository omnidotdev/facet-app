import { describe, expect, test } from "bun:test";

import { collectSubpaths } from "./svgPath";

/**
 * Pure (OCCT-free) tests for full-SVG ingestion: `collectSubpaths` turns either a
 * bare path `d` string or a whole `<svg>` document into flattened, absolute,
 * transform-baked polylines in SVG space. The B-rep end-to-end path is covered
 * separately in svgPath.test.ts.
 */

/** Axis-aligned bounds of every point across all subpaths. */
function bounds(input: string) {
  const subs = collectSubpaths(input);
  const pts = subs.flat();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    count: subs.length,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe("collectSubpaths", () => {
  test("a bare path d string still parses (backward compatible)", () => {
    const subs = collectSubpaths("M0 0 L10 0 L10 10 Z");
    expect(subs).toHaveLength(1);
    // closing Z returns to start; the three corners are present
    const b = bounds("M0 0 L10 0 L10 10 Z");
    expect(near(b.minX, 0)).toBe(true);
    expect(near(b.maxX, 10)).toBe(true);
    expect(near(b.maxY, 10)).toBe(true);
  });

  test("a full <svg> with one <path> matches the bare d", () => {
    const d = "M0 0 L10 0 L10 10 Z";
    const doc = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`;
    expect(collectSubpaths(doc)).toEqual(collectSubpaths(d));
  });

  test("multiple <path> elements are all collected", () => {
    const doc = `<svg><path d="M0 0 L5 0 L5 5 Z"/><path d="M20 0 L25 0 L25 5 Z"/></svg>`;
    const b = bounds(doc);
    expect(b.count).toBe(2);
    expect(near(b.minX, 0)).toBe(true);
    expect(near(b.maxX, 25)).toBe(true);
  });

  test("<rect> becomes a rectangular region", () => {
    const b = bounds(`<svg><rect x="2" y="3" width="10" height="4"/></svg>`);
    expect(b.count).toBe(1);
    expect(near(b.minX, 2)).toBe(true);
    expect(near(b.maxX, 12)).toBe(true);
    expect(near(b.minY, 3)).toBe(true);
    expect(near(b.maxY, 7)).toBe(true);
  });

  test("<circle> becomes a closed loop with the right bounds", () => {
    const b = bounds(`<svg><circle cx="10" cy="10" r="5"/></svg>`);
    expect(b.count).toBe(1);
    // flattened arc bounds reach the circle's extent (within flattening error)
    expect(Math.abs(b.minX - 5)).toBeLessThan(0.1);
    expect(Math.abs(b.maxX - 15)).toBeLessThan(0.1);
    expect(Math.abs(b.minY - 5)).toBeLessThan(0.1);
    expect(Math.abs(b.maxY - 15)).toBeLessThan(0.1);
  });

  test("<polygon> points become a closed region", () => {
    const b = bounds(`<svg><polygon points="0,0 10,0 10,8"/></svg>`);
    expect(b.count).toBe(1);
    expect(near(b.maxX, 10)).toBe(true);
    expect(near(b.maxY, 8)).toBe(true);
  });

  test("a transform='translate(...)' on an element shifts its geometry", () => {
    const b = bounds(
      `<svg><rect x="0" y="0" width="4" height="4" transform="translate(10,20)"/></svg>`,
    );
    expect(near(b.minX, 10)).toBe(true);
    expect(near(b.maxX, 14)).toBe(true);
    expect(near(b.minY, 20)).toBe(true);
    expect(near(b.maxY, 24)).toBe(true);
  });

  test("a group transform composes with an inner element transform", () => {
    const b = bounds(
      `<svg><g transform="scale(2)"><rect x="1" y="1" width="3" height="3" transform="translate(5,0)"/></g></svg>`,
    );
    // inner translate(5,0) then group scale(2): x in [ (1+5)*2, (4+5)*2 ] = [12,18]
    expect(near(b.minX, 12)).toBe(true);
    expect(near(b.maxX, 18)).toBe(true);
    expect(near(b.minY, 2)).toBe(true);
    expect(near(b.maxY, 8)).toBe(true);
  });

  test("matrix() transform is applied", () => {
    // matrix(1 0 0 1 7 9) is a pure translate by (7,9)
    const b = bounds(
      `<svg><rect x="0" y="0" width="2" height="2" transform="matrix(1 0 0 1 7 9)"/></svg>`,
    );
    expect(near(b.minX, 7)).toBe(true);
    expect(near(b.maxY, 11)).toBe(true);
  });

  test("an empty or geometry-less SVG yields no subpaths", () => {
    expect(collectSubpaths(`<svg></svg>`)).toHaveLength(0);
  });
});
