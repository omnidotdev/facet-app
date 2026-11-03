import { describe, expect, test } from "bun:test";

import {
  cube,
  cylinder,
  difference,
  grid,
  rectTube,
  sphere,
  union,
} from "./api";

describe("authoring API builds an op-graph without computing geometry", () => {
  test("cube is centered by default", () => {
    expect(cube(10).node).toEqual({
      op: "cube",
      size: [10, 10, 10],
      center: true,
    });
  });

  test("cube accepts a size vector and an uncentered flag", () => {
    expect(cube([2, 4, 6], { center: false }).node).toEqual({
      op: "cube",
      size: [2, 4, 6],
      center: false,
    });
  });

  test("fluent transforms nest as child nodes", () => {
    const node = cube(1).translate(1, 2, 3).node;
    expect(node).toEqual({
      op: "translate",
      v: [1, 2, 3],
      child: { op: "cube", size: [1, 1, 1], center: true },
    });
  });

  test("uniform scale from a single number", () => {
    const node = sphere(1).scale(3).node;
    expect(node).toMatchObject({ op: "scale", v: [3, 3, 3] });
  });

  test("subtract collects base + cutters into a difference node", () => {
    const node = difference(cube(10), cylinder(2, 20)).node;
    expect(node.op).toBe("difference");
    if (node.op === "difference") {
      expect(node.children).toHaveLength(2);
      expect(node.children[0]).toMatchObject({ op: "cube" });
      expect(node.children[1]).toMatchObject({ op: "cylinder" });
    }
  });

  test("free-function union matches the method form", () => {
    const a = union(cube(1), sphere(1)).node;
    const b = cube(1).union(sphere(1)).node;
    expect(a).toEqual(b);
  });

  test("fillet wraps the shape in a fillet node", () => {
    const node = cube(10).fillet(2).node;
    expect(node).toEqual({
      op: "fillet",
      radius: 2,
      child: { op: "cube", size: [10, 10, 10], center: true },
    });
  });

  test("chamfer wraps the shape in a chamfer node", () => {
    const node = cube(10).chamfer(1.5).node;
    expect(node).toEqual({
      op: "chamfer",
      size: 1.5,
      child: { op: "cube", size: [10, 10, 10], center: true },
    });
  });

  test("shell wraps the shape in a shell node", () => {
    const node = cube(10).shell(2).node;
    expect(node).toEqual({
      op: "shell",
      thickness: 2,
      child: { op: "cube", size: [10, 10, 10], center: true },
    });
  });

  test("the new B-rep ops chain fluently onto transforms", () => {
    const node = cube(10).shell(2).fillet(1).translate(0, 0, 5).node;
    expect(node.op).toBe("translate");
    if (node.op === "translate") {
      expect(node.child.op).toBe("fillet");
    }
  });

  test("grid tiles a shape into a centered union of translated copies", () => {
    const node = grid(cube(1), 2, 1, 10).node;
    expect(node.op).toBe("union");
    if (node.op === "union") {
      expect(node.children).toHaveLength(2);
      // 2 columns spaced 10, centered -> x at -5 and +5
      const xs = node.children.map((c) =>
        c.op === "translate" ? c.v[0] : Number.NaN,
      );
      expect(xs).toEqual([-5, 5]);
    }
  });

  test("grid floors counts and keeps at least one copy", () => {
    const node = grid(cube(1), 0, 0, 5).node;
    // Math.max(1, ...) keeps a single copy, so union has one child
    expect(node.op).toBe("union");
    if (node.op === "union") expect(node.children).toHaveLength(1);
  });

  test("rectTube subtracts an inner box from an outer box", () => {
    const node = rectTube([20, 10], 2, 5).node;
    expect(node).toEqual({
      op: "difference",
      children: [
        { op: "cube", size: [20, 10, 5], center: true },
        { op: "cube", size: [16, 6, 7], center: true },
      ],
    });
  });

  test("rectTube degrades to a solid block when the walls meet", () => {
    const node = rectTube([8, 8], 4, 5).node;
    // inner width = 8 - 2*4 = 0 -> no subtraction, just the outer box
    expect(node).toEqual({ op: "cube", size: [8, 8, 5], center: true });
  });
});
