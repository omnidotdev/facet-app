import { describe, expect, test } from "bun:test";

import { cube, cylinder, difference, sphere, union } from "./api";

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
});
