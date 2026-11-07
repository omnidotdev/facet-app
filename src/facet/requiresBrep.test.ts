import { describe, expect, test } from "bun:test";

import { requiresBrep, shouldAutoSwitchToBrep } from "./opgraph";

import type { OpNode } from "./opgraph";

const cube: OpNode = { op: "cube", size: [10, 10, 10], center: true };

describe("requiresBrep", () => {
  test("is false for a lone primitive", () => {
    expect(requiresBrep(cube)).toBe(false);
    expect(requiresBrep({ op: "sphere", r: 5, segments: 32 })).toBe(false);
    expect(
      requiresBrep({
        op: "cone",
        r1: 2,
        r2: 1,
        h: 4,
        segments: 32,
        center: true,
      }),
    ).toBe(false);
  });

  test("is false for a polyhedron (explicit mesh)", () => {
    const tetra: OpNode = {
      op: "polyhedron",
      points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      faces: [3, 0, 2, 1, 3, 0, 1, 3, 3, 1, 2, 3, 3, 2, 0, 3],
    };
    expect(requiresBrep(tetra)).toBe(false);
  });

  test("is false for a pure boolean graph of primitives", () => {
    const graph: OpNode = {
      op: "difference",
      children: [
        cube,
        { op: "cylinder", r: 3, h: 20, segments: 32, center: true },
      ],
    };
    expect(requiresBrep(graph)).toBe(false);
  });

  test("is false for a transform wrapping only primitives", () => {
    const graph: OpNode = { op: "translate", v: [0, 0, 5], child: cube };
    expect(requiresBrep(graph)).toBe(false);
  });

  test("is false for a deeply nested all-primitive graph", () => {
    const graph: OpNode = {
      op: "union",
      children: [
        { op: "rotate", deg: [0, 0, 30], child: cube },
        {
          op: "difference",
          children: [
            {
              op: "scale",
              v: [2, 2, 2],
              child: { op: "sphere", r: 5, segments: 16 },
            },
            { op: "cylinder", r: 3, h: 20, segments: 32, center: true },
          ],
        },
      ],
    };
    expect(requiresBrep(graph)).toBe(false);
  });

  test("is true for each B-rep-only op at the root", () => {
    expect(requiresBrep({ op: "fillet", radius: 1, child: cube })).toBe(true);
    expect(requiresBrep({ op: "chamfer", size: 1, child: cube })).toBe(true);
    expect(requiresBrep({ op: "shell", thickness: 2, child: cube })).toBe(true);
  });

  test("hull is false when every child needs no B-rep", () => {
    const graph: OpNode = {
      op: "hull",
      children: [cube, { op: "sphere", r: 5, segments: 32 }],
    };
    expect(requiresBrep(graph)).toBe(false);
  });

  test("hull is true when any child needs B-rep", () => {
    const graph: OpNode = {
      op: "hull",
      children: [
        { op: "fillet", radius: 1, child: cube },
        { op: "sphere", r: 5, segments: 32 },
      ],
    };
    expect(requiresBrep(graph)).toBe(true);
  });

  test("recurses through a single-child transform", () => {
    const graph: OpNode = {
      op: "translate",
      v: [0, 0, 5],
      child: { op: "fillet", radius: 1, child: cube },
    };
    expect(requiresBrep(graph)).toBe(true);
  });

  test("detects a shell wrapping a transform", () => {
    const graph: OpNode = {
      op: "shell",
      thickness: 2,
      child: {
        op: "rotate",
        deg: [0, 0, 45],
        child: cube,
      },
    };
    expect(requiresBrep(graph)).toBe(true);
  });

  test("a 2D transform of a simple profile stays out of B-rep", () => {
    const circle: OpNode = { op: "circle2d", r: 5, segments: 64 };
    expect(requiresBrep({ op: "translate2d", v: [2, 3], child: circle })).toBe(
      false,
    );
    expect(requiresBrep({ op: "rotate2d", angle: 30, child: circle })).toBe(
      false,
    );
    expect(requiresBrep({ op: "scale2d", factor: 2, child: circle })).toBe(
      false,
    );
    expect(
      requiresBrep({ op: "mirror2d", normal: [1, 0], child: circle }),
    ).toBe(false);
  });

  test("a 2D transform of a curved/combined profile forces B-rep", () => {
    const svg: OpNode = { op: "svg2d", path: "M0 0 L10 0 L5 8 Z" };
    const label: OpNode = { op: "text2d", text: "A", size: 10 };
    expect(requiresBrep({ op: "mirror2d", normal: [1, 0], child: svg })).toBe(
      true,
    );
    expect(requiresBrep({ op: "translate2d", v: [1, 1], child: label })).toBe(
      true,
    );
  });

  test("detects a fillet nested inside a boolean child", () => {
    const graph: OpNode = {
      op: "union",
      children: [
        cube,
        {
          op: "difference",
          children: [
            { op: "sphere", r: 5, segments: 32 },
            {
              op: "scale",
              v: [2, 2, 2],
              child: { op: "chamfer", size: 1, child: cube },
            },
          ],
        },
      ],
    };
    expect(requiresBrep(graph)).toBe(true);
  });
});

describe("shouldAutoSwitchToBrep", () => {
  const brepGraph: OpNode = { op: "fillet", radius: 1, child: cube };

  test("switches when a B-rep graph runs on a non-B-rep kernel", () => {
    expect(shouldAutoSwitchToBrep(brepGraph, "ts")).toBe(true);
    expect(shouldAutoSwitchToBrep(brepGraph, "rust")).toBe(true);
  });

  test("does not switch when the B-rep kernel is already active", () => {
    expect(shouldAutoSwitchToBrep(brepGraph, "brep")).toBe(false);
  });

  test("does not switch for a graph that needs no B-rep ops", () => {
    expect(shouldAutoSwitchToBrep(cube, "ts")).toBe(false);
    expect(shouldAutoSwitchToBrep(cube, "rust")).toBe(false);
  });
});
