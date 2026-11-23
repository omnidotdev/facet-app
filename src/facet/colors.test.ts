import { describe, expect, test } from "bun:test";

import { Shape } from "./api";
import {
  combineParts,
  evaluateColored,
  exportColored,
  hasColor,
  splitByColor,
  stripColors,
} from "./colors";
import { meshBounds } from "./kernel";
import { meshKernel } from "./meshKernel";
import { parseColor } from "./parseColor";

import type { OpNode } from "./opgraph";

const cube = (size: number): OpNode => ({
  op: "cube",
  size: [size, size, size],
  center: true,
});
const red: [number, number, number] = [1, 0, 0];
const blue: [number, number, number] = [0, 0, 1];
const colored = (rgb: [number, number, number], child: OpNode): OpNode => ({
  op: "color",
  rgb,
  child,
});

/** Read one file out of a stored (uncompressed) ZIP */
const unzipEntry = (zip: Uint8Array, name: string): string => {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const entry = new TextDecoder().decode(
      zip.subarray(offset + 30, offset + 30 + nameLength),
    );
    const start = offset + 30 + nameLength;
    if (entry === name)
      return new TextDecoder().decode(zip.subarray(start, start + size));
    offset = start + size;
  }
  throw new Error(`${name} not in the package`);
};

describe("parseColor", () => {
  test("reads names, hex codes, and 0 to 1 triples", () => {
    expect(parseColor("red")).toEqual([1, 0, 0]);
    expect(parseColor(" SteelBlue ")).toEqual([70 / 255, 130 / 255, 180 / 255]);
    expect(parseColor("#e0218a")).toEqual([224 / 255, 33 / 255, 138 / 255]);
    expect(parseColor("#f08")).toEqual([1, 0, 136 / 255]);
    expect(parseColor([0.2, 0.4, 1])).toEqual([0.2, 0.4, 1]);
  });

  test("explains what it accepts when a color is unknown", () => {
    expect(() => parseColor("reddish")).toThrow(/color name like "red"/);
    expect(() => parseColor("#12345")).toThrow(/hex code/);
    expect(() => parseColor([255, 0, 0])).toThrow(/from 0 to 1/);
    expect(() => parseColor([1, 0])).toThrow(/three numbers/);
  });

  test("Shape.color builds a color node", () => {
    const node = new Shape(cube(10)).color("blue").node;
    expect(node).toEqual({ op: "color", rgb: [0, 0, 1], child: cube(10) });
  });
});

describe("splitByColor", () => {
  test("an uncolored model is one uncolored part, untouched", () => {
    const node: OpNode = { op: "union", children: [cube(1), cube(2)] };
    expect(splitByColor(node)).toEqual([{ node, color: null }]);
    expect(hasColor(node)).toBe(false);
  });

  test("a union keeps colors apart and merges the same color", () => {
    const node: OpNode = {
      op: "union",
      children: [
        colored(red, cube(1)),
        colored(blue, cube(2)),
        colored(red, cube(3)),
      ],
    };
    expect(splitByColor(node)).toEqual([
      { color: red, node: { op: "union", children: [cube(1), cube(3)] } },
      { color: blue, node: cube(2) },
    ]);
  });

  test("the innermost color wins", () => {
    const node = colored(red, {
      op: "union",
      children: [colored(blue, cube(1)), cube(2)],
    });
    expect(splitByColor(node)).toEqual([
      { color: blue, node: cube(1) },
      { color: red, node: cube(2) },
    ]);
  });

  test("a difference cuts every colored part, whatever the cutter's color", () => {
    const hole: OpNode = colored(blue, cube(0.5));
    const node: OpNode = {
      op: "difference",
      children: [
        { op: "union", children: [colored(red, cube(4)), cube(6)] },
        hole,
      ],
    };
    expect(splitByColor(node)).toEqual([
      {
        color: red,
        node: { op: "difference", children: [cube(4), cube(0.5)] },
      },
      {
        color: null,
        node: { op: "difference", children: [cube(6), cube(0.5)] },
      },
    ]);
  });

  test("transforms apply to each part", () => {
    const node: OpNode = {
      op: "translate",
      v: [5, 0, 0],
      child: { op: "union", children: [colored(red, cube(1)), cube(2)] },
    };
    expect(splitByColor(node)).toEqual([
      { color: red, node: { op: "translate", v: [5, 0, 0], child: cube(1) } },
      { color: null, node: { op: "translate", v: [5, 0, 0], child: cube(2) } },
    ]);
  });

  test("a hull wraps everything in its first color", () => {
    const node: OpNode = {
      op: "hull",
      children: [cube(1), colored(blue, cube(2)), colored(red, cube(3))],
    };
    expect(splitByColor(node)).toEqual([
      {
        color: blue,
        node: { op: "hull", children: [cube(1), cube(2), cube(3)] },
      },
    ]);
  });

  test("no part graph carries a color op", () => {
    const node: OpNode = {
      op: "difference",
      children: [
        colored(red, {
          op: "union",
          children: [colored(blue, cube(1)), cube(2)],
        }),
        colored(red, cube(0.5)),
      ],
    };
    for (const part of splitByColor(node))
      expect(hasColor(part.node)).toBe(false);
    expect(hasColor(stripColors(node))).toBe(false);
  });
});

describe("colored evaluation and export", () => {
  // A red plate with an uncolored post on top
  const model: OpNode = {
    op: "union",
    children: [
      colored(red, { op: "cube", size: [20, 10, 2], center: true }),
      { op: "translate", v: [0, 0, 3], child: cube(4) },
    ],
  };

  test("joins the parts with per-vertex colors", async () => {
    const mesh = await evaluateColored(meshKernel, model);
    expect(mesh.colors).toBeDefined();
    const colors = mesh.colors as Float32Array;
    expect(colors.length).toBe(mesh.triangleCount * 12);
    // Both cubes are 12 triangles: the plate's vertices are red, the post's
    // keep the base color (alpha 0)
    expect(Array.from(colors.subarray(0, 4))).toEqual([1, 0, 0, 1]);
    expect(colors[(12 * 3 + 1) * 4 - 1]).toBe(0);
    const { min, max } = meshBounds(mesh);
    expect(min[2]).toBeCloseTo(-1);
    expect(max[2]).toBeCloseTo(5);
  });

  test("an uncolored model evaluates exactly as before", async () => {
    const plain = stripColors(model);
    const mesh = await evaluateColored(meshKernel, plain);
    expect(mesh.colors).toBeUndefined();
    expect(mesh.triangleCount).toBe(meshKernel.evaluate(plain).triangleCount);
  });

  test("combineParts keeps every triangle in order", () => {
    const a = meshKernel.evaluate(cube(1));
    const b = meshKernel.evaluate(cube(2));
    const mesh = combineParts([
      { mesh: a, color: null },
      { mesh: b, color: blue },
    ]);
    expect(mesh.triangleCount).toBe(a.triangleCount + b.triangleCount);
    expect(Array.from(mesh.positions.subarray(0, 9))).toEqual(
      Array.from(a.positions.subarray(0, 9)),
    );
  });

  test("a 3MF carries each part as a colored part of one object", async () => {
    const data = await exportColored(meshKernel, model, "3mf");
    const xml = unzipEntry(data, "3D/3dmodel.model");
    expect(xml).toContain('<basematerials id="1">');
    expect(xml).toContain('displaycolor="#FF0000"');
    // The uncolored post is written in the default part color
    expect(xml).toContain('displaycolor="#DD6E33"');
    expect(xml).toContain(
      '<object id="2" name="Part 1" type="model" pid="1" pindex="0">',
    );
    expect(xml).toContain(
      '<object id="3" name="Part 2" type="model" pid="1" pindex="1">',
    );
    expect(xml).toContain(
      '<components><component objectid="2"/><component objectid="3"/></components>',
    );
    expect(xml).toContain('<build><item objectid="4"/></build>');
  });

  test("an STL joins the parts, since it has no color", async () => {
    const data = await exportColored(meshKernel, model, "stl");
    const triangles = new DataView(data.buffer, data.byteOffset).getUint32(
      80,
      true,
    );
    expect(triangles).toBe(24);
  });
});
