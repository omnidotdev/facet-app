import { describe, expect, test } from "bun:test";

import { circleSegments, is2dBoolean, polygonize } from "@/facet/polygon2d";

import type { MultiPolygon } from "polygon-clipping";
import type { OpNode } from "@/facet/opgraph";

const TOL = { chordTolerance: 0.1, angularTolerance: 0.3 };

/** Signed shoelace area of every ring, holes counted negative */
const area = (shape: MultiPolygon | null): number => {
  if (!shape) throw new Error("expected a polygon");
  let total = 0;
  for (const polygon of shape)
    polygon.forEach((ring, i) => {
      let a = 0;
      // Wrap around, so open and closed rings both measure correctly
      for (let k = 0; k < ring.length; k++) {
        const [x0, y0] = ring[k];
        const [x1, y1] = ring[(k + 1) % ring.length];
        a += x0 * y1 - x1 * y0;
      }
      // The outline counts positive and each hole negative, whatever the winding
      total += i === 0 ? Math.abs(a / 2) : -Math.abs(a / 2);
    });
  return total;
};

const square = (size: number): OpNode => ({
  op: "rect2d",
  size: [size, size],
  center: true,
});

describe("polygonize", () => {
  test("keeps an explicit low-segment circle as that polygon", () => {
    const hexagon = polygonize({ op: "circle2d", r: 10, segments: 6 }, TOL);
    expect(hexagon?.[0][0]).toHaveLength(6);
    // Same first vertex as replicad's drawPolysides (straight up)
    expect(hexagon?.[0][0][0][0]).toBeCloseTo(0);
    expect(hexagon?.[0][0][0][1]).toBeCloseTo(10);
  });

  test("flattens a smooth circle finely enough to match its area", () => {
    const circle = polygonize({ op: "circle2d", r: 10, segments: 64 }, TOL);
    expect(area(circle)).toBeCloseTo(Math.PI * 100, -1);
  });

  test("merges a deep chain of unions in one pass", () => {
    // a = a.union(b) twenty times: overlapping squares along a line
    let node: OpNode = square(2);
    for (let i = 1; i <= 20; i++)
      node = {
        op: "union2d",
        children: [node, { op: "translate2d", v: [i, 0], child: square(2) }],
      };
    const merged = polygonize(node, TOL);
    expect(merged).toHaveLength(1);
    expect(area(merged)).toBeCloseTo(22 * 2);
  });

  test("cuts a hole with a difference", () => {
    const ring = polygonize(
      {
        op: "difference2d",
        children: [square(10), square(4)],
      },
      TOL,
    );
    expect(ring?.[0]).toHaveLength(2);
    expect(area(ring)).toBeCloseTo(100 - 16);
  });

  test("applies rotate, scale, and mirror like the exact kernel", () => {
    const tri: OpNode = { op: "polygon2d", points: [0, 0, 4, 0, 0, 2] };
    const rotated = polygonize({ op: "rotate2d", angle: 90, child: tri }, TOL);
    // (4, 0) turns to (0, 4) for a counter-clockwise quarter turn
    expect(rotated?.[0][0][1][0]).toBeCloseTo(0);
    expect(rotated?.[0][0][1][1]).toBeCloseTo(4);
    const scaled = polygonize({ op: "scale2d", factor: 3, child: tri }, TOL);
    expect(area(scaled)).toBeCloseTo(4 * 9);
    // Mirroring across the y axis keeps the area and stays a valid input to the
    // clipper once unioned
    const mirrored = polygonize(
      {
        op: "union2d",
        children: [tri, { op: "mirror2d", normal: [1, 0], child: tri }],
      },
      TOL,
    );
    expect(area(mirrored)).toBeCloseTo(8);
  });

  test("gives up on pieces with no polygon form", () => {
    expect(
      polygonize(
        {
          op: "union2d",
          children: [square(2), { op: "text2d", text: "A", size: 5 }],
        },
        TOL,
      ),
    ).toBeNull();
    expect(
      polygonize({ op: "offset2d", distance: 1, child: square(2) }, TOL),
    ).toBeNull();
  });
});

describe("helpers", () => {
  test("only 2D booleans take the draft path", () => {
    expect(is2dBoolean({ op: "union2d", children: [] })).toBe(true);
    expect(is2dBoolean(square(1))).toBe(false);
  });

  test("circle segments follow the tighter tolerance", () => {
    // Small circles are bound by the angular tolerance, large ones by chord
    expect(circleSegments(1, 0.1, 0.3)).toBe(Math.ceil((2 * Math.PI) / 0.3));
    expect(circleSegments(100, 0.1, 0.3)).toBeGreaterThan(60);
  });
});
