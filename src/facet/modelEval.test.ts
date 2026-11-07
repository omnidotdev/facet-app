import { describe, expect, test } from "bun:test";

import { buildModel } from "./modelEval";

describe("buildModel", () => {
  test("builds an op-graph from a returned shape", () => {
    const res = buildModel("return cube(10);", {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.node.op).toBe("cube");
      expect(res.decls).toEqual([]);
    }
  });

  test("evaluates booleans into a difference node", () => {
    const res = buildModel("return cube(10).subtract(cylinder(3, 20));", {});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.node.op).toBe("difference");
  });

  test("declares parameters and seeds them from values", () => {
    const code =
      'const w = param.number("width", { min: 1, max: 100, default: 20 });\nreturn cube(w);';
    const fresh = buildModel(code, {});
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.decls).toHaveLength(1);
      expect(fresh.decls[0]).toMatchObject({
        kind: "number",
        name: "width",
        value: 20,
      });
    }
    // A stored value (a moved slider) overrides the default
    const tuned = buildModel(code, { width: 55 });
    expect(tuned.ok).toBe(true);
    if (tuned.ok) {
      expect(tuned.decls[0]).toMatchObject({ name: "width", value: 55 });
    }
  });

  test("exposes polyhedron in the sandbox", () => {
    const res = buildModel(
      "return polyhedron([[0,0,0],[1,0,0],[0,1,0],[0,0,1]], [[0,2,1],[0,1,3],[1,2,3],[2,0,3]]);",
      {},
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.node.op).toBe("polyhedron");
  });

  test("returns a friendly error when nothing is returned", () => {
    const res = buildModel("const x = cube(1);", {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/must `return` a shape/);
  });

  test("returns the thrown message on bad code, never throwing", () => {
    const res = buildModel("return nope(1);", {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
  });
});
