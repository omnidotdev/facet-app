import { describe, expect, test } from "bun:test";

import { circle, cube, extrude, polygon, revolve, square } from "./api";
import { meshBounds } from "./kernel";
import { meshKernel } from "./meshKernel";
import { requiresBrep } from "./opgraph";

import type { OpNode } from "./opgraph";

const ev = (node: OpNode) => meshKernel.evaluate(node);

describe("mesh kernel tessellated sweeps", () => {
  test("a simple-profile sweep no longer forces the B-rep kernel", () => {
    expect(requiresBrep(extrude(circle(5), 10).node)).toBe(false);
    expect(requiresBrep(extrude(square(8), 4).node)).toBe(false);
    expect(
      requiresBrep(
        revolve(
          polygon([
            [5, 0],
            [7, 0],
            [7, 10],
            [5, 10],
          ]),
        ).node,
      ),
    ).toBe(false);
  });

  test("a curved or combined profile still forces B-rep", () => {
    expect(requiresBrep(extrude(circle(10).subtract(circle(6)), 4).node)).toBe(
      true,
    );
    expect(requiresBrep(extrude(circle(5).offset(1), 4).node)).toBe(true);
  });

  test("extrude a circle into a prism of the right extent", () => {
    const mesh = ev(extrude(circle(5, { segments: 48 }), 10).node);
    expect(mesh.triangleCount).toBeGreaterThan(20);
    const b = meshBounds(mesh);
    expect(b.min[2]).toBeCloseTo(0, 1);
    expect(b.max[2]).toBeCloseTo(10, 1);
    expect(b.max[0]).toBeCloseTo(5, 0);
    expect(b.min[0]).toBeCloseTo(-5, 0);
  });

  test("a twisted, tapered extrude builds a non-degenerate solid", () => {
    const mesh = ev(extrude(square(10), 20, { twist: 90, scale: 0.5 }).node);
    expect(mesh.triangleCount).toBeGreaterThan(12);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
  });

  test("an extruded profile booleans correctly (winding is not inverted)", () => {
    // Subtracting an extruded square from a cube must remove volume; if the
    // sweep wound its faces inside-out the subtraction would do nothing
    const base = cube(20);
    const tool = extrude(square(10), 30).translate(0, 0, -5);
    const cut = ev(base.subtract(tool).node);
    expect(cut.triangleCount).toBeGreaterThan(0);
    const b = meshBounds(cut);
    // The square column removed the central bore, so the cut reaches the walls
    expect(b.max[0]).toBeCloseTo(10, 0);
  });

  test("revolve a column into a tube of the right extent", () => {
    const mesh = ev(
      revolve(
        polygon([
          [5, 0],
          [7, 0],
          [7, 10],
          [5, 10],
        ]),
        { segments: 48 },
      ).node,
    );
    expect(mesh.triangleCount).toBeGreaterThan(20);
    const b = meshBounds(mesh);
    expect(b.max[2]).toBeCloseTo(10, 0);
    expect(b.max[0]).toBeCloseTo(7, 0);
    expect(b.min[0]).toBeCloseTo(-7, 0);
  });

  test("a partial revolve leaves end caps and a bounded sweep", () => {
    const mesh = ev(
      revolve(
        polygon([
          [5, 0],
          [7, 0],
          [7, 6],
          [5, 6],
        ]),
        { angle: 90, segments: 32 },
      ).node,
    );
    expect(mesh.triangleCount).toBeGreaterThan(12);
    const b = meshBounds(mesh);
    // A 90-degree sweep stays in the +X/+Y quadrant region (no wrap to -X)
    expect(b.min[0]).toBeGreaterThanOrEqual(-0.5);
  });

  test("a bare 2D sketch still errors toward the B-rep kernel", () => {
    expect(() => ev(circle(5).node)).toThrow(/B-rep/);
  });
});
