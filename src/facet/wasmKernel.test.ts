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

  // polyhedron decodes and fan-triangulates the same flat lists in TS
  // (polyhedron.ts) and Rust (polyhedron.rs); an index/count divergence or a
  // different fan order would surface as a mesh mismatch here. A cube's quad
  // faces exercise the fan, and a hexagonal prism's 6-gon caps exercise a longer
  // fan so the emit order of a multi-triangle fan is verified across TS/Rust
  const cubePolyhedron = (): OpNode => ({
    op: "polyhedron",
    points: [
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
    ],
    faces: [
      4, 0, 3, 2, 1, 4, 4, 5, 6, 7, 4, 0, 1, 5, 4, 4, 3, 7, 6, 2, 4, 0, 4, 7, 3,
      4, 1, 2, 6, 5,
    ],
  });

  // A square pyramid: a quad base plus four triangular sides, so faces of mixed
  // vertex counts fan in one model
  const pyramidPolyhedron = (): OpNode => ({
    op: "polyhedron",
    points: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, 0, 0, 2],
    faces: [4, 0, 3, 2, 1, 3, 0, 1, 4, 3, 1, 2, 4, 3, 2, 3, 4, 3, 3, 0, 4],
  });

  // A hexagonal prism: two 6-gon caps (each a 4-triangle fan) plus six quad
  // sides, so a face longer than a quad drives the fan across both kernels. The
  // ring coordinates are computed once and cross identically to the Rust side
  const hexPrism = (): OpNode => {
    const points: number[] = [];
    for (const z of [0, 2])
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        points.push(Math.cos(a), Math.sin(a), z);
      }
    // Bottom cap (indices 0..5) wound for a -Z outward normal, top cap (6..11)
    // for +Z, then six side quads
    const faces: number[] = [6, 5, 4, 3, 2, 1, 0, 6, 6, 7, 8, 9, 10, 11];
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      faces.push(4, i, j, 6 + j, 6 + i);
    }
    return { op: "polyhedron", points, faces };
  };

  // A valid tetrahedron plus a zero-area face (repeated index): both kernels
  // must drop the degenerate fan triangle, so the meshes stay identical and
  // carry no NaN. A divergence in the degeneracy guard would surface here
  const degenerateFacePolyhedron = (): OpNode => ({
    op: "polyhedron",
    points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    faces: [3, 0, 2, 1, 3, 0, 1, 3, 3, 1, 2, 3, 3, 2, 0, 3, 3, 0, 1, 0],
  });

  for (const [name, build] of [
    ["a cube", cubePolyhedron],
    ["a square pyramid", pyramidPolyhedron],
    ["a hexagonal prism", hexPrism],
    ["a degenerate-face solid", degenerateFacePolyhedron],
  ] as const) {
    test.skipIf(!kernel)(
      `polyhedron ${name} meshes identically to the TS mesh kernel`,
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
        for (const v of rust.normals) expect(Number.isNaN(v)).toBe(false);
      },
    );
  }

  // The 2D transform point-math is duplicated in TS (meshSweep.ts) and Rust
  // (sweep.rs); a transformed simple profile must tessellate bit-identically or
  // the WASM kernel silently regresses. Each case extrudes a transformed ring,
  // the input that exercises every arm (translate, rotate, scale, and the
  // orientation-flipping mirror)
  const extrudeOf = (child: OpNode): OpNode => ({
    op: "extrude",
    height: 3,
    twist: 0,
    scale: 1,
    child,
  });
  const square8 = (): OpNode => ({
    op: "rect2d",
    size: [8, 8],
    center: true,
  });
  const leaningTriangle = (): OpNode => ({
    op: "polygon2d",
    points: [0, 0, 10, 0, 10, 6],
  });

  for (const [name, build] of [
    [
      "a translated square",
      () => extrudeOf({ op: "translate2d", v: [10, 5], child: square8() }),
    ],
    [
      "a scaled, translated square",
      () =>
        extrudeOf({
          op: "scale2d",
          factor: 2,
          child: { op: "translate2d", v: [10, 0], child: square8() },
        }),
    ],
    [
      "a mirrored leaning triangle",
      () =>
        extrudeOf({ op: "mirror2d", normal: [1, 0], child: leaningTriangle() }),
    ],
    [
      // A non-axis normal exercises the normalization path, where an imprecise
      // length (Math.hypot vs a plain sqrt) would diverge from the Rust side by
      // a ULP and tessellate differently
      "a mirrored leaning triangle across a diagonal",
      () =>
        extrudeOf({ op: "mirror2d", normal: [1, 1], child: leaningTriangle() }),
    ],
  ] as const) {
    // translate/scale/mirror are algebraic (add/multiply/sqrt), and IEEE
    // add/multiply/sqrt are correctly rounded, so TS and Rust must agree bit for
    // bit
    test.skipIf(!kernel)(
      `a transformed profile (${name}) meshes identically to the TS mesh kernel`,
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

  // Rotation runs the ring through sin/cos, which are NOT correctly-rounded
  // transcendentals: V8's Math.sin/cos and wasm libm's can differ by a ULP, so
  // a rotated profile matches within a tight floating-point tolerance rather
  // than bit for bit (unlike the algebraic transforms above)
  test.skipIf(!kernel)(
    "a rotated profile matches the TS mesh kernel within floating-point tolerance",
    () => {
      const node = extrudeOf({
        op: "rotate2d",
        angle: 37,
        child: { op: "rect2d", size: [10, 2], center: true },
      });
      const ts = meshKernel.evaluate(node);
      const rust = kernel?.evaluate(node);
      expect(rust).toBeTruthy();
      if (!rust) return;
      expect(rust.triangleCount).toBe(ts.triangleCount);
      for (let i = 0; i < ts.positions.length; i++)
        expect(rust.positions[i]).toBeCloseTo(ts.positions[i], 9);
      for (let i = 0; i < ts.normals.length; i++)
        expect(rust.normals[i]).toBeCloseTo(ts.normals[i], 9);
    },
  );
});
