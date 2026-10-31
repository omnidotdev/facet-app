import { describe, expect, test } from "bun:test";

import { requiresBrep, shouldAutoSwitchToBrep } from "./opgraph";

import type { OpNode } from "./opgraph";

const cube: OpNode = { op: "cube", size: [10, 10, 10], center: true };

describe("requiresBrep", () => {
  test("is false for a lone primitive", () => {
    expect(requiresBrep(cube)).toBe(false);
    expect(requiresBrep({ op: "sphere", r: 5, segments: 32 })).toBe(false);
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
