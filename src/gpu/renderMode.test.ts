import { describe, expect, test } from "bun:test";

import { meshKernel } from "@/facet/meshKernel";
import {
  allEdgeFlags,
  creaseEdgeFlags,
  nextRenderMode,
  parseRenderMode,
  renderStyleFor,
} from "./renderMode";

import type { Mesh } from "@/facet/kernel";

/** The display edges a flag array draws, as pairs of endpoint positions */
const drawnEdges = (mesh: Mesh, flags: Float32Array) => {
  const out: { a: number[]; b: number[] }[] = [];
  const p = mesh.positions;
  const vertex = (t: number, k: number) =>
    Array.from(p.subarray(t * 9 + k * 3, t * 9 + k * 3 + 3));
  for (let t = 0; t < mesh.triangleCount; t++)
    for (let k = 0; k < 3; k++)
      if (flags[t * 9 + k] === 1)
        out.push({ a: vertex(t, (k + 1) % 3), b: vertex(t, (k + 2) % 3) });
  return out;
};

/** Build a mesh from triangles given as three [x, y, z] corners */
const meshOf = (triangles: number[][][]): Mesh => {
  const positions = new Float32Array(triangles.flat(2));
  return {
    positions,
    normals: new Float32Array(positions.length),
    triangleCount: triangles.length,
  };
};

describe("crease edges", () => {
  test("a cube draws its 12 edges and none of its face diagonals", () => {
    const mesh = meshKernel.evaluate({
      op: "cube",
      size: [10, 10, 10],
      center: true,
    });
    const edges = drawnEdges(mesh, creaseEdgeFlags(mesh));
    // Each cube edge is shared by two triangles, so it is drawn from both
    expect(edges.length).toBe(24);
    // Every drawn edge runs along one axis (a diagonal changes two coordinates)
    for (const { a, b } of edges) {
      const changed = [0, 1, 2].filter((i) => Math.abs(a[i] - b[i]) > 1e-6);
      expect(changed.length).toBe(1);
    }
  });

  test("a T-junction inside a flat face draws no false crease", () => {
    // One flat square, split along its diagonal, with the upper half split
    // again at the diagonal's midpoint: the lower triangle's diagonal meets a
    // vertex in its middle, as the mesh kernel's booleans leave behind
    const mesh = meshOf([
      [
        [0, 0, 0],
        [2, 0, 0],
        [2, 2, 0],
      ],
      [
        [0, 0, 0],
        [1, 1, 0],
        [0, 2, 0],
      ],
      [
        [1, 1, 0],
        [2, 2, 0],
        [0, 2, 0],
      ],
    ]);
    const edges = drawnEdges(mesh, creaseEdgeFlags(mesh));
    const onDiagonal = edges.filter(
      ({ a, b }) =>
        Math.abs(a[0] - a[1]) < 1e-6 && Math.abs(b[0] - b[1]) < 1e-6,
    );
    expect(onDiagonal).toEqual([]);
    // The square's open outline still draws: four sides, once each
    expect(edges.length).toBe(4);
  });

  test("a cylinder draws its two rims but not the seams between facets", () => {
    const mesh = meshKernel.evaluate({
      op: "cylinder",
      r: 5,
      h: 8,
      center: false,
      segments: 48,
    });
    const edges = drawnEdges(mesh, creaseEdgeFlags(mesh));
    expect(edges.length).toBeGreaterThan(0);
    for (const { a, b } of edges) {
      // Rim edges are horizontal, at the bottom or the top
      expect(a[2]).toBeCloseTo(b[2], 5);
      expect([0, 8].some((z) => Math.abs(a[2] - z) < 1e-4)).toBe(true);
      // and on the rim circle, not across a cap
      expect(Math.hypot(a[0], a[1])).toBeCloseTo(5, 3);
      expect(Math.hypot(b[0], b[1])).toBeCloseTo(5, 3);
    }
  });

  test("a boolean's split faces draw only the real outline and hole rim", () => {
    // A plate with a hole through it: the mesh kernel's boolean leaves
    // T-junctions across the flat top and bottom
    const mesh = meshKernel.evaluate({
      op: "difference",
      children: [
        { op: "cube", size: [20, 20, 4], center: true },
        { op: "cylinder", r: 4, h: 10, center: true, segments: 32 },
      ],
    });
    const edges = drawnEdges(mesh, creaseEdgeFlags(mesh));
    const onOutline = (q: number[]) =>
      Math.abs(Math.abs(q[0]) - 10) < 1e-4 ||
      Math.abs(Math.abs(q[1]) - 10) < 1e-4;
    const onRim = (q: number[]) => Math.abs(Math.hypot(q[0], q[1]) - 4) < 1e-3;
    for (const { a, b } of edges.filter(
      (e) => Math.abs(e.a[2] - 2) < 1e-4 && Math.abs(e.b[2] - 2) < 1e-4,
    )) {
      expect((onOutline(a) && onOutline(b)) || (onRim(a) && onRim(b))).toBe(
        true,
      );
    }
    // and the rim is still drawn all the way around: the distinct rim edges
    // at the top add up to the hole's 32-sided perimeter
    const rim = new Map<string, number>();
    for (const { a, b } of edges) {
      if (Math.abs(a[2] - 2) > 1e-4 || Math.abs(b[2] - 2) > 1e-4) continue;
      if (!onRim(a) || !onRim(b)) continue;
      const key = [a, b]
        .map((q) => q.map((x) => x.toFixed(3)).join(","))
        .sort()
        .join("|");
      rim.set(key, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    const drawn = [...rim.values()].reduce((sum, len) => sum + len, 0);
    expect(drawn).toBeCloseTo(32 * 2 * 4 * Math.sin(Math.PI / 32), 2);
  });

  test("wireframe flags every edge", () => {
    expect(Array.from(allEdgeFlags(2))).toEqual(new Array(18).fill(1));
  });
});

describe("render mode helpers", () => {
  test("cycles through every mode and wraps", () => {
    expect(nextRenderMode("shaded")).toBe("edges");
    expect(nextRenderMode("edges")).toBe("wireframe");
    expect(nextRenderMode("wireframe")).toBe("xray");
    expect(nextRenderMode("xray")).toBe("shaded");
  });

  test("parses unknown stored values as shaded", () => {
    expect(parseRenderMode("xray")).toBe("xray");
    expect(parseRenderMode("sketchy")).toBe("shaded");
    expect(parseRenderMode(null)).toBe("shaded");
  });

  test("see-through modes drop or thin the fill, shaded draws no lines", () => {
    expect(renderStyleFor("shaded", "light", 1).style[1]).toBe(0);
    expect(renderStyleFor("edges", "light", 1).style[0]).toBe(1);
    expect(renderStyleFor("wireframe", "dark", 1).style[0]).toBe(0);
    expect(renderStyleFor("xray", "dark", 1).style[0]).toBeLessThan(1);
    // Line width follows the device pixel ratio
    expect(renderStyleFor("edges", "light", 2).style[2]).toBe(
      2 * renderStyleFor("edges", "light", 1).style[2],
    );
  });
});
