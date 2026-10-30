import { describe, expect, test } from "bun:test";

import { meshKernel } from "./meshKernel";

import type { OpNode, Vec3 } from "./opgraph";
import type { OpNode as GeneratedOpNode } from "./opgraph.gen";

/**
 * A nested op-graph exercising every structural shape the IR can take: a
 * primitive carrying a Vec3 field, a transform wrapping a single child, and a
 * boolean op over a children array.
 */
const sample: OpNode = {
  op: "difference",
  children: [
    { op: "cube", size: [10, 10, 10], center: true },
    {
      op: "translate",
      v: [0, 0, 5],
      child: { op: "cylinder", r: 3, h: 20, segments: 32, center: true },
    },
  ],
};

describe("op-graph contract", () => {
  test("round-trips through JSON unchanged", () => {
    const wire = JSON.stringify(sample);
    const parsed = JSON.parse(wire) as OpNode;
    expect(parsed).toEqual(sample);
  });

  test("tags each node with its op discriminator", () => {
    expect(sample.op).toBe("difference");
    const [cubeNode, translateNode] = sample.children;
    expect(cubeNode.op).toBe("cube");
    expect(translateNode.op).toBe("translate");
    // The discriminator is what both kernels and serde switch on
    if (translateNode.op === "translate") {
      expect(translateNode.child.op).toBe("cylinder");
    }
  });

  test("the public OpNode is the ODK-generated type", () => {
    // Type-level: the public name and the generated name must be mutually
    // assignable, proving opgraph.ts re-exports the generated contract
    const fromPublic: GeneratedOpNode = sample;
    const fromGenerated: OpNode = fromPublic;
    expect(fromGenerated).toEqual(sample);
  });

  test("evaluates through the mesh kernel to a non-empty mesh", () => {
    // Match the Rust test's depth: deserialize-shaped nested graph -> geometry
    const mesh = meshKernel.evaluate(JSON.parse(JSON.stringify(sample)));
    expect(mesh.triangleCount).toBeGreaterThan(0);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
  });

  test("Vec3 stays a fixed-length numeric triple", () => {
    const v: Vec3 = [1, 2, 3];
    expect(v).toHaveLength(3);
  });

  test("round-trips a graph nesting the B-rep-only ops through JSON", () => {
    // fillet/chamfer/shell are single-child nodes like a transform, so a nested
    // enclosure (shell a box, then round its edges) must survive the wire
    const enclosure: OpNode = {
      op: "fillet",
      radius: 1,
      child: {
        op: "shell",
        thickness: 2,
        child: { op: "cube", size: [20, 20, 20], center: true },
      },
    };
    const parsed = JSON.parse(JSON.stringify(enclosure)) as OpNode;
    expect(parsed).toEqual(enclosure);
    expect(parsed.op).toBe("fillet");
    if (parsed.op === "fillet") {
      expect(parsed.radius).toBe(1);
      expect(parsed.child.op).toBe("shell");
    }
  });

  test("the generated union carries the three B-rep-only ops", () => {
    // Type-level: each new variant is assignable to the generated contract
    const fillet: GeneratedOpNode = {
      op: "fillet",
      radius: 2,
      child: { op: "cube", size: [1, 1, 1], center: true },
    };
    const chamfer: GeneratedOpNode = {
      op: "chamfer",
      size: 1,
      child: { op: "cube", size: [1, 1, 1], center: true },
    };
    const shell: GeneratedOpNode = {
      op: "shell",
      thickness: 1,
      child: { op: "cube", size: [1, 1, 1], center: true },
    };
    expect([fillet.op, chamfer.op, shell.op]).toEqual([
      "fillet",
      "chamfer",
      "shell",
    ]);
  });
});
