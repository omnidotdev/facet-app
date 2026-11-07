import { describe, expect, test } from "bun:test";

import { cube } from "./api";
import { meshKernel } from "./meshKernel";
import { loadWasmKernel } from "./wasmKernel";

import type { OpNode } from "./opgraph";

// Load the Rust/WASM kernel the way the app does. The web-target glue fetches
// the wasm by URL, which may not resolve under every runner, so tolerate a null
// and skip rather than fail the suite when the kernel is unavailable here.
const kernel = await loadWasmKernel();

describe("Rust/WASM kernel", () => {
  // A canary mirroring the OCCT suite: if the kernel stops loading under the
  // runner, this flags it instead of letting the skipIf test pass silently
  test("loads the Rust/WASM kernel under the test runner", () => {
    expect(kernel).not.toBeNull();
  });

  test.skipIf(!kernel)(
    "rejects STEP export and points at the B-rep kernel",
    () => {
      // The Rust kernel tessellates, so STEP (exact B-rep) has no equivalent
      expect(() => kernel?.export(cube(10).node, "step")).toThrow(
        /B-rep kernel/,
      );
    },
  );

  // The hull algorithm is duplicated in TS (hull.ts) and Rust (hull.rs); they
  // must stay geometrically identical or the WASM kernel silently regresses
  // against the mesh kernel. Both run the same algorithm on the same point
  // cloud (the primitives match), so the tessellated hull must be bit-identical.
  // Integer cube corners are the easy case; curved/cospherical and
  // coplanar-heavy clouds are where a float divergence or order-sensitive
  // triangulation would surface, so assert bit-identity on all three
  const translatedCube = (
    x: number,
    y: number,
    z: number,
    size = 1,
  ): OpNode => ({
    op: "translate",
    v: [x, y, z],
    child: { op: "cube", size: [size, size, size], center: true },
  });

  const cubeCorners = (): OpNode => {
    const children: OpNode[] = [];
    for (const x of [-5, 5])
      for (const y of [-5, 5])
        for (const z of [-5, 5]) children.push(translatedCube(x, y, z));
    return { op: "hull", children };
  };

  // A capsule: two tessellated spheres whose cospherical rings triangulate in a
  // tie-break-sensitive order, the input most likely to expose a divergence
  const twoSpheres = (): OpNode => ({
    op: "hull",
    children: [
      {
        op: "translate",
        v: [0, 0, 0],
        child: { op: "sphere", r: 4, segments: 16 },
      },
      {
        op: "translate",
        v: [20, 0, 0],
        child: { op: "sphere", r: 4, segments: 16 },
      },
    ],
  });

  // Coplanar-heavy: a 3x3x2 lattice of unit cubes, so each z layer contributes
  // many coplanar points that a hull must fold into flat faces consistently
  const coplanarLattice = (): OpNode => {
    const children: OpNode[] = [];
    for (const x of [-4, 0, 4])
      for (const y of [-4, 0, 4])
        for (const z of [0, 6]) children.push(translatedCube(x, y, z));
    return { op: "hull", children };
  };

  for (const [name, build] of [
    ["cube corners", cubeCorners],
    ["two cospherical spheres", twoSpheres],
    ["a coplanar-heavy lattice", coplanarLattice],
  ] as const) {
    test.skipIf(!kernel)(
      `hull of ${name} meshes identically to the TS mesh kernel`,
      () => {
        const node = build();
        const ts = meshKernel.evaluate(node);
        const rust = kernel?.evaluate(node);
        expect(rust).toBeTruthy();
        if (!rust) return;
        expect(rust.triangleCount).toBeGreaterThan(0);
        expect(rust.triangleCount).toBe(ts.triangleCount);
        expect(Array.from(rust.positions)).toEqual(Array.from(ts.positions));
        expect(Array.from(rust.normals)).toEqual(Array.from(ts.normals));
      },
    );
  }
});
