import { describe, expect, test } from "bun:test";

import {
  circle,
  cone,
  cube,
  cylinder,
  difference,
  extrude,
  grid,
  hull,
  importSvg,
  polygon,
  polyhedron,
  rect,
  rectTube,
  revolve,
  sphere,
  square,
  text,
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

  test("cone carries its radii, height, and defaults", () => {
    expect(cone(2, 1, 4).node).toEqual({
      op: "cone",
      r1: 2,
      r2: 1,
      h: 4,
      segments: 32,
      center: true,
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

  test("mirror records the plane normal and nests the child", () => {
    const node = cube(10).translate(5, 0, 0).mirror([1, 0, 0]).node;
    expect(node).toMatchObject({
      op: "mirror",
      normal: [1, 0, 0],
      child: { op: "translate", v: [5, 0, 0] },
    });
  });

  test("mirror accepts loose x/y/z arguments", () => {
    expect(cube(1).mirror(0, 1, 0).node).toMatchObject({
      op: "mirror",
      normal: [0, 1, 0],
    });
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

  test("hull collects its children into a hull node", () => {
    expect(hull(cube(1), sphere(1)).node).toEqual({
      op: "hull",
      children: [cube(1).node, sphere(1).node],
    });
  });

  test("empty hull throws", () => {
    expect(() => hull()).toThrow(/at least one shape/);
  });

  test("polyhedron flattens points and count-prefixes each face", () => {
    const node = polyhedron(
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [
        [0, 2, 1],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ],
    ).node;
    expect(node).toEqual({
      op: "polyhedron",
      points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      faces: [3, 0, 2, 1, 3, 0, 1, 3, 3, 1, 2, 3, 3, 2, 0, 3],
    });
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

describe("2D sketch and sweep API builds an op-graph", () => {
  test("circle defaults to a smooth profile", () => {
    expect(circle(5).node).toEqual({ op: "circle2d", r: 5, segments: 64 });
  });

  test("circle honors an explicit segment count (polygon profile)", () => {
    expect(circle(5, { segments: 6 }).node).toEqual({
      op: "circle2d",
      r: 5,
      segments: 6,
    });
  });

  test("square is centered by default; rect is an alias", () => {
    expect(square(10).node).toEqual({
      op: "rect2d",
      size: [10, 10],
      center: true,
    });
    expect(rect([4, 8], { center: false }).node).toEqual({
      op: "rect2d",
      size: [4, 8],
      center: false,
    });
  });

  test("polygon accepts [x,y] pairs and flattens them", () => {
    expect(
      polygon([
        [0, 0],
        [10, 0],
        [5, 8],
      ]).node,
    ).toEqual({ op: "polygon2d", points: [0, 0, 10, 0, 5, 8] });
  });

  test("text wraps content in a text2d sketch node with a default size", () => {
    expect(text("OMNI").node).toEqual({ op: "text2d", text: "OMNI", size: 10 });
    expect(text("7", { size: 24 }).node).toMatchObject({
      op: "text2d",
      size: 24,
    });
  });

  test("importSvg wraps an svg path in a svg2d sketch node", () => {
    const node = importSvg("M0 0 L10 0 L10 10 Z").node;
    expect(node).toEqual({ op: "svg2d", path: "M0 0 L10 0 L10 10 Z" });
  });

  test("polygon accepts an already-flat point list", () => {
    expect(polygon([0, 0, 10, 0, 5, 8]).node).toEqual({
      op: "polygon2d",
      points: [0, 0, 10, 0, 5, 8],
    });
  });

  test("extrude wraps a sketch with no-op twist/scale defaults", () => {
    const node = extrude(square(6), 10).node;
    expect(node).toEqual({
      op: "extrude",
      height: 10,
      twist: 0,
      scale: 1,
      child: { op: "rect2d", size: [6, 6], center: true },
    });
  });

  test("extrude carries twist and taper through", () => {
    const node = circle(4).extrude(20, { twist: 90, scale: 0.5 }).node;
    expect(node).toMatchObject({
      op: "extrude",
      height: 20,
      twist: 90,
      scale: 0.5,
    });
  });

  test("revolve defaults to a full turn", () => {
    const node = revolve(polygon([5, 0, 7, 0, 7, 10, 5, 10])).node;
    expect(node).toMatchObject({ op: "revolve", angle: 360, segments: 64 });
  });

  test("2D booleans and offset nest as child sketches", () => {
    const node = circle(10).subtract(circle(6)).offset(0.5).node;
    expect(node.op).toBe("offset2d");
    if (node.op === "offset2d") {
      expect(node.distance).toBe(0.5);
      expect(node.child.op).toBe("difference2d");
    }
  });
});

describe("2D sketch transforms build an op-graph", () => {
  test("translate records the vector and nests the child", () => {
    const node = circle(5).translate(3, 4).node;
    expect(node).toEqual({
      op: "translate2d",
      v: [3, 4],
      child: { op: "circle2d", r: 5, segments: 64 },
    });
  });

  test("translate defaults the y offset to zero and accepts a vector", () => {
    expect(circle(5).translate(2).node).toMatchObject({
      op: "translate2d",
      v: [2, 0],
    });
    expect(circle(5).translate([2, 7]).node).toMatchObject({
      op: "translate2d",
      v: [2, 7],
    });
  });

  test("move is an alias for translate", () => {
    expect(square(4).move(1, 2).node).toMatchObject({
      op: "translate2d",
      v: [1, 2],
    });
  });

  test("rotate records the angle in degrees", () => {
    expect(square(4).rotate(30).node).toEqual({
      op: "rotate2d",
      angle: 30,
      child: { op: "rect2d", size: [4, 4], center: true },
    });
  });

  test("scale records a uniform factor", () => {
    expect(circle(2).scale(3).node).toEqual({
      op: "scale2d",
      factor: 3,
      child: { op: "circle2d", r: 2, segments: 64 },
    });
  });

  test("mirror records the line normal and nests the child", () => {
    const node = polygon([0, 0, 10, 0, 5, 8]).mirror([1, 0]).node;
    expect(node).toEqual({
      op: "mirror2d",
      normal: [1, 0],
      child: { op: "polygon2d", points: [0, 0, 10, 0, 5, 8] },
    });
  });

  test("mirror defaults the y component to zero and accepts loose args", () => {
    expect(circle(5).mirror(0, 1).node).toMatchObject({
      op: "mirror2d",
      normal: [0, 1],
    });
    expect(circle(5).mirror(1).node).toMatchObject({
      op: "mirror2d",
      normal: [1, 0],
    });
  });

  test("transforms chain and stay in the sketch domain (extrude consumes them)", () => {
    const shape = square(4).translate(10, 0).mirror([1, 0]).extrude(2);
    expect(shape.node.op).toBe("extrude");
    if (shape.node.op === "extrude") {
      expect(shape.node.child.op).toBe("mirror2d");
    }
  });
});

describe("2D sketch transforms reject degenerate inputs at the boundary", () => {
  test("mirror rejects a zero-length normal", () => {
    // A zero normal has no line to reflect across; the kernels disagree on it
    // (a silent no-op in mesh, a throw in B-rep), so stop it at the boundary
    expect(() => circle(5).mirror([0, 0])).toThrow(/normal/i);
    expect(() => circle(5).mirror(0, 0)).toThrow(/normal/i);
  });

  test("mirror rejects a non-finite normal", () => {
    expect(() => circle(5).mirror([Number.NaN, 1])).toThrow(/normal/i);
    expect(() => circle(5).mirror(Number.POSITIVE_INFINITY, 0)).toThrow(
      /normal/i,
    );
  });

  test("scale rejects a zero or non-finite factor", () => {
    expect(() => circle(5).scale(0)).toThrow(/scale|factor/i);
    expect(() => circle(5).scale(Number.NaN)).toThrow(/scale|factor/i);
    expect(() => circle(5).scale(Number.POSITIVE_INFINITY)).toThrow(
      /scale|factor/i,
    );
  });

  test("rotate rejects a non-finite angle", () => {
    expect(() => circle(5).rotate(Number.NaN)).toThrow(/angle/i);
    expect(() => circle(5).rotate(Number.POSITIVE_INFINITY)).toThrow(/angle/i);
  });

  test("a negative scale factor is allowed (a reflection through the origin)", () => {
    expect(circle(5).scale(-1).node).toMatchObject({
      op: "scale2d",
      factor: -1,
    });
  });
});
