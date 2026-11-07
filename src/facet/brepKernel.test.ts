import { describe, expect, test } from "bun:test";

import { evaluateOpGraph, exportOpGraphStep } from "./brepKernel";

import type { OpNode } from "./opgraph";

/**
 * Load OCCT the way a non-Vite runtime must: resolve the wasm from the package
 * and hand its bytes to the Emscripten factory directly (the browser path uses
 * Vite's `?url` asset instead). Returns the replicad module, or null if OCCT
 * cannot load here, so the rest of the suite never depends on it being present.
 */
async function loadReplicad(): Promise<typeof import("replicad") | null> {
  try {
    const ocInit = (await import("replicad-opencascadejs")).default;
    const wasmPath = Bun.fileURLToPath(
      import.meta.resolve("replicad-opencascadejs/wasm"),
    );
    const wasmBinary = await Bun.file(wasmPath).arrayBuffer();
    const oc = await ocInit({ wasmBinary, locateFile: () => wasmPath });
    const rc = await import("replicad");
    rc.setOC(oc);
    return rc;
  } catch (err) {
    console.warn("OCCT unavailable under the test runner, skipping:", err);
    return null;
  }
}

const rc = await loadReplicad();

describe("OCCT B-rep kernel", () => {
  // A non-skipped canary: if OCCT ever stops loading under the runner, fail
  // loudly here rather than letting every skipIf test pass silently
  test("loads OCCT under the test runner", () => {
    expect(rc).not.toBeNull();
  });

  test.skipIf(!rc)("tessellates a cube into a well-formed mesh", () => {
    const node: OpNode = { op: "cube", size: [10, 10, 10], center: true };
    const mesh = evaluateOpGraph(rc!, node);
    expect(mesh.triangleCount).toBeGreaterThan(0);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
    expect(mesh.normals.length).toBe(mesh.triangleCount * 9);
  });

  test.skipIf(!rc)("evaluates a boolean difference of two primitives", () => {
    const node: OpNode = {
      op: "difference",
      children: [
        { op: "cube", size: [20, 20, 20], center: true },
        { op: "sphere", r: 12, segments: 32 },
      ],
    };
    const mesh = evaluateOpGraph(rc!, node);
    // Subtracting the sphere carves a curved cavity, so the result has strictly
    // more triangles than the bare box's 12
    expect(mesh.triangleCount).toBeGreaterThan(12);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
    expect(mesh.normals.length).toBe(mesh.triangleCount * 9);
  });

  test.skipIf(!rc)(
    "honors a low segment count as an exact polygon prism",
    () => {
      const node: OpNode = {
        op: "cylinder",
        r: 10,
        h: 5,
        center: false,
        segments: 6,
      };
      const mesh = evaluateOpGraph(rc!, node);
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        minX = Math.min(minX, mesh.positions[i]);
        maxX = Math.max(maxX, mesh.positions[i]);
        minY = Math.min(minY, mesh.positions[i + 1]);
        maxY = Math.max(maxY, mesh.positions[i + 1]);
      }
      // Hexagon, circumradius 10, first vertex on +X: 20 wide across corners in X,
      // but only 10*sqrt(3) ~= 17.32 across flats in Y. A round cylinder would
      // span 20 in both, so the shrunken Y proves this is an exact hex prism
      expect(maxX - minX).toBeCloseTo(20, 1);
      expect(maxY - minY).toBeCloseTo(10 * Math.sqrt(3), 1);
    },
  );

  test.skipIf(!rc)("keeps a high segment count an exact round cylinder", () => {
    const node: OpNode = {
      op: "cylinder",
      r: 10,
      h: 5,
      center: false,
      segments: 48,
    };
    const mesh = evaluateOpGraph(rc!, node);
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      minY = Math.min(minY, mesh.positions[i]);
      maxY = Math.max(maxY, mesh.positions[i]);
    }
    // Round: spans the full diameter (~20) in Y, unlike the hex prism's 17.32
    expect(maxY - minY).toBeGreaterThan(19);
  });

  test.skipIf(!rc)("revolves a sharp-apex cone (r2 = 0)", () => {
    const node: OpNode = {
      op: "cone",
      r1: 2,
      r2: 0,
      h: 4,
      segments: 32,
      center: true,
    };
    const mesh = evaluateOpGraph(rc!, node);
    expect(mesh.triangleCount).toBeGreaterThan(0);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
    expect(mesh.normals.length).toBe(mesh.triangleCount * 9);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      minX = Math.min(minX, mesh.positions[i]);
      maxX = Math.max(maxX, mesh.positions[i]);
      minZ = Math.min(minZ, mesh.positions[i + 2]);
      maxZ = Math.max(maxZ, mesh.positions[i + 2]);
    }
    // Bottom radius 2 spans the full diameter in X, and centered height 4 runs
    // from -2 to 2 in Z
    expect(maxX - minX).toBeCloseTo(4, 1);
    expect(maxZ - minZ).toBeCloseTo(4, 1);
  });

  test.skipIf(!rc)("revolves a truncated cone (r2 > 0)", () => {
    const node: OpNode = {
      op: "cone",
      r1: 2,
      r2: 1,
      h: 4,
      segments: 32,
      center: true,
    };
    const mesh = evaluateOpGraph(rc!, node);
    expect(mesh.triangleCount).toBeGreaterThan(0);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
    expect(mesh.normals.length).toBe(mesh.triangleCount * 9);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      minX = Math.min(minX, mesh.positions[i]);
      maxX = Math.max(maxX, mesh.positions[i]);
      minZ = Math.min(minZ, mesh.positions[i + 2]);
      maxZ = Math.max(maxZ, mesh.positions[i + 2]);
    }
    // The wider bottom radius 2 sets the X diameter, height 4 centered in Z
    expect(maxX - minX).toBeCloseTo(4, 1);
    expect(maxZ - minZ).toBeCloseTo(4, 1);
  });

  test.skipIf(!rc)("falls back to a mesh for a non-uniform scale", () => {
    const node: OpNode = {
      op: "scale",
      v: [1, 1, 1.25],
      child: { op: "cube", size: [10, 10, 10], center: true },
    };
    const mesh = evaluateOpGraph(rc!, node);
    expect(mesh.triangleCount).toBeGreaterThan(0);
    let zMax = Number.NEGATIVE_INFINITY;
    for (let i = 2; i < mesh.positions.length; i += 3)
      zMax = Math.max(zMax, mesh.positions[i]);
    // 10 mm cube centered on the origin, scaled 1.25x in Z, so the top sits at
    // 6.25 mm
    expect(zMax).toBeCloseTo(6.25, 3);
  });

  test.skipIf(!rc)("rounds every edge of a box with a fillet", () => {
    const node: OpNode = {
      op: "fillet",
      radius: 1,
      child: { op: "cube", size: [10, 10, 10], center: true },
    };
    const mesh = evaluateOpGraph(rc!, node);
    // Rounding the 12 edges replaces each with a curved strip, so the result
    // has far more than the bare box's 12 triangles
    expect(mesh.triangleCount).toBeGreaterThan(12);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
    expect(mesh.normals.length).toBe(mesh.triangleCount * 9);
  });

  test.skipIf(!rc)("chamfers every edge of a box", () => {
    const node: OpNode = {
      op: "chamfer",
      size: 1,
      child: { op: "cube", size: [10, 10, 10], center: true },
    };
    const mesh = evaluateOpGraph(rc!, node);
    expect(mesh.triangleCount).toBeGreaterThan(12);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
  });

  test.skipIf(!rc)("hollows a box into an open-topped shell", () => {
    const solid: OpNode = { op: "cube", size: [20, 20, 20], center: true };
    const shelled: OpNode = { op: "shell", thickness: 2, child: solid };
    const solidMesh = evaluateOpGraph(rc!, solid);
    const shelledMesh = evaluateOpGraph(rc!, shelled);
    // The hollow walls plus the opening add surface area, so the shell
    // tessellates to more triangles than the solid box it came from
    expect(shelledMesh.triangleCount).toBeGreaterThan(solidMesh.triangleCount);
    expect(shelledMesh.positions.length).toBe(shelledMesh.triangleCount * 9);
  });

  test.skipIf(!rc)("builds a filleted, shelled enclosure", () => {
    // The combined enclosure case, in the engineering-correct order: round the
    // solid box's edges, then hollow it open-topped. (Rounding AFTER shelling a
    // 2 mm wall by a radius that fills the wall is physically impossible and
    // OCCT correctly refuses it, so the fillet wraps the solid, not the shell)
    const node: OpNode = {
      op: "shell",
      thickness: 2,
      child: {
        op: "fillet",
        radius: 1,
        child: { op: "cube", size: [40, 30, 20], center: true },
      },
    };
    const mesh = evaluateOpGraph(rc!, node);
    expect(mesh.triangleCount).toBeGreaterThan(12);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
    expect(mesh.normals.length).toBe(mesh.triangleCount * 9);
  });

  test.skipIf(!rc)("refuses a B-rep op on a non-uniformly scaled child", () => {
    // A non-uniform scale drops to a tessellated mesh, which fillet/chamfer/
    // shell cannot operate on, so the kernel must reject it, not crash
    const node: OpNode = {
      op: "fillet",
      radius: 1,
      child: {
        op: "scale",
        v: [1, 1, 1.5],
        child: { op: "cube", size: [10, 10, 10], center: true },
      },
    };
    expect(() => evaluateOpGraph(rc!, node)).toThrow(/B-rep/);
  });

  test.skipIf(!rc)("sweeps OCCT handles across repeated evaluations", () => {
    const node: OpNode = {
      op: "difference",
      children: [
        { op: "cube", size: [20, 20, 20], center: true },
        { op: "sphere", r: 12, segments: 32 },
      ],
    };
    const oc = rc!.getOC() as unknown as { wasmMemory: WebAssembly.Memory };
    const heapBytes = () => oc.wasmMemory.buffer.byteLength;
    // Warm up so one-time allocations settle, then prove the wasm heap does not
    // grow as evaluation repeats: localGC frees every handle each pass, so a
    // leak (the pre-review bug) would show here as a climbing heap
    for (let i = 0; i < 5; i++) evaluateOpGraph(rc!, node);
    const warmHeap = heapBytes();
    for (let i = 0; i < 40; i++) {
      const mesh = evaluateOpGraph(rc!, node);
      expect(mesh.triangleCount).toBeGreaterThan(0);
    }
    expect(heapBytes()).toBeLessThanOrEqual(warmHeap);
  });

  test.skipIf(!rc)("exports a cube to an ISO-10303-21 B-rep STEP", () => {
    const node: OpNode = { op: "cube", size: [10, 10, 10], center: true };
    const bytes = exportOpGraphStep(rc!, node);
    expect(bytes.length).toBeGreaterThan(0);
    const text = new TextDecoder().decode(bytes);
    // A real STEP part file opens with the ISO-10303-21 exchange header
    expect(text.startsWith("ISO-10303-21;")).toBe(true);
    expect(text).toContain("FILE_DESCRIPTION");
    // Exact B-rep entities, so this is the analytic solid, not a mesh dump
    expect(text).toContain("MANIFOLD_SOLID_BREP");
    expect(text).toContain("ADVANCED_BREP_SHAPE_REPRESENTATION");
  });

  test.skipIf(!rc)("exports a filleted part as exact B-rep STEP", () => {
    const node: OpNode = {
      op: "fillet",
      radius: 1,
      child: { op: "cube", size: [10, 10, 10], center: true },
    };
    const bytes = exportOpGraphStep(rc!, node);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("ISO-10303-21;")).toBe(true);
    expect(text).toContain("MANIFOLD_SOLID_BREP");
  });

  test.skipIf(!rc)("refuses STEP when the geometry dropped to a mesh", () => {
    // A non-uniform scale has no exact B-rep, so STEP export must refuse rather
    // than silently emit nothing or crash
    const node: OpNode = {
      op: "scale",
      v: [1, 1, 1.5],
      child: { op: "cube", size: [10, 10, 10], center: true },
    };
    expect(() => exportOpGraphStep(rc!, node)).toThrow(/exact geometry/);
  });

  test.skipIf(!rc)("sweeps OCCT handles across repeated STEP exports", () => {
    const node: OpNode = {
      op: "fillet",
      radius: 1,
      child: { op: "cube", size: [10, 10, 10], center: true },
    };
    const heapBytes = () => rc!.getOC().wasmMemory.buffer.byteLength;
    // STEP export allocates the writer, progress handle, and the evaluated
    // solid; a leak in any of them would climb the heap across repeats
    for (let i = 0; i < 5; i++) exportOpGraphStep(rc!, node);
    const warmHeap = heapBytes();
    for (let i = 0; i < 20; i++) {
      const bytes = exportOpGraphStep(rc!, node);
      expect(bytes.length).toBeGreaterThan(0);
    }
    expect(heapBytes()).toBeLessThanOrEqual(warmHeap);
  });

  test.skipIf(!rc)("extrudes a 2D square into a solid prism", () => {
    const node: OpNode = {
      op: "extrude",
      height: 10,
      twist: 0,
      scale: 1,
      child: { op: "rect2d", size: [8, 8], center: true },
    };
    const mesh = evaluateOpGraph(rc!, node);
    // A box has 12 triangles (2 per face), the floor for an untwisted prism
    expect(mesh.triangleCount).toBeGreaterThanOrEqual(12);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
    expect(mesh.normals.length).toBe(mesh.triangleCount * 9);
  });

  test.skipIf(!rc)(
    "a twisted, tapered extrude builds a non-degenerate solid",
    () => {
      const node: OpNode = {
        op: "extrude",
        height: 20,
        twist: 90,
        scale: 0.5,
        child: { op: "circle2d", r: 6, segments: 64 },
      };
      const mesh = evaluateOpGraph(rc!, node);
      // The twist + taper curve the walls, so the solid tessellates well past a
      // plain box; mostly a smoke test that the profile config path builds
      expect(mesh.triangleCount).toBeGreaterThan(12);
      expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
    },
  );

  test.skipIf(!rc)("revolves a profile into a solid of revolution", () => {
    // A column sitting between x=5 and x=7 (its X is the radius, its Y the
    // height), revolved a full turn, is a tube; kept off the Z axis so the
    // profile never straddles it
    const node: OpNode = {
      op: "revolve",
      angle: 360,
      segments: 64,
      child: {
        op: "polygon2d",
        points: [5, 0, 7, 0, 7, 10, 5, 10],
      },
    };
    const mesh = evaluateOpGraph(rc!, node);
    expect(mesh.triangleCount).toBeGreaterThan(12);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
  });

  test.skipIf(!rc)("extrudes a 2D boolean (a ring) into a tube", () => {
    const node: OpNode = {
      op: "extrude",
      height: 5,
      twist: 0,
      scale: 1,
      child: {
        op: "difference2d",
        children: [
          { op: "circle2d", r: 10, segments: 64 },
          { op: "circle2d", r: 6, segments: 64 },
        ],
      },
    };
    const mesh = evaluateOpGraph(rc!, node);
    expect(mesh.triangleCount).toBeGreaterThan(12);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
  });

  test.skipIf(!rc)("refuses to mesh a bare 2D sketch", () => {
    // A sketch is not a solid; the kernel must guide the user to extrude/revolve
    const node: OpNode = { op: "circle2d", r: 5, segments: 64 };
    expect(() => evaluateOpGraph(rc!, node)).toThrow(/sketch|extrude|revolve/i);
  });

  test.skipIf(!rc)("refuses to extrude a 3D shape instead of a sketch", () => {
    const node: OpNode = {
      op: "extrude",
      height: 5,
      twist: 0,
      scale: 1,
      child: { op: "cube", size: [2, 2, 2], center: true },
    };
    expect(() => evaluateOpGraph(rc!, node)).toThrow(/2D sketch/i);
  });

  test.skipIf(!rc)("mirrors an exact solid across a plane", () => {
    // A cube translated to +X, mirrored across the plane with normal [1,0,0],
    // must stay an exact solid and land in -X (replicad's exact mirror)
    const node: OpNode = {
      op: "mirror",
      normal: [1, 0, 0],
      child: {
        op: "translate",
        v: [20, 0, 0],
        child: { op: "cube", size: [10, 10, 10], center: true },
      },
    };
    const mesh = evaluateOpGraph(rc!, node);
    expect(mesh.triangleCount).toBeGreaterThan(0);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      minX = Math.min(minX, mesh.positions[i]);
      maxX = Math.max(maxX, mesh.positions[i]);
    }
    // It spanned 15..25 in X; after the flip it is entirely in -X
    expect(maxX).toBeLessThan(0);
    expect(minX).toBeGreaterThan(-30);
  });
});

/** Signed volume of a closed triangle mesh via the divergence theorem. */
function brepMeshVolume(mesh: {
  positions: Float32Array;
  triangleCount: number;
}): number {
  let v = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.triangleCount; t++) {
    const b = t * 9;
    v +=
      (p[b] * (p[b + 4] * p[b + 8] - p[b + 5] * p[b + 7]) -
        p[b + 1] * (p[b + 3] * p[b + 8] - p[b + 5] * p[b + 6]) +
        p[b + 2] * (p[b + 3] * p[b + 7] - p[b + 4] * p[b + 6])) /
      6;
  }
  return Math.abs(v);
}

describe("B-rep hull wraps a convex solid around its children", () => {
  // Eight unit cubes centered at the corners of a 10-unit box; the convex hull
  // of the cloud is the solid 11-unit box (extreme points at +/-5.5)
  function cornerCubes(): OpNode {
    const children: OpNode[] = [];
    for (const x of [-5, 5])
      for (const y of [-5, 5])
        for (const z of [-5, 5])
          children.push({
            op: "translate",
            v: [x, y, z],
            child: { op: "cube", size: [1, 1, 1], center: true },
          });
    return { op: "hull", children };
  }

  test.skipIf(!rc)("hull of eight corner cubes fills the bounding box", () => {
    const mesh = evaluateOpGraph(rc!, cornerCubes());
    expect(mesh.triangleCount).toBeGreaterThan(0);
    const min = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ];
    const max = [
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], mesh.positions[i + a]);
        max[a] = Math.max(max[a], mesh.positions[i + a]);
      }
    }
    for (let a = 0; a < 3; a++) {
      expect(min[a]).toBeCloseTo(-5.5, 3);
      expect(max[a]).toBeCloseTo(5.5, 3);
    }
    // The exact solid 11-unit box has volume 11^3 = 1331
    expect(brepMeshVolume(mesh)).toBeCloseTo(1331, 0);
  });

  test.skipIf(!rc)("hull of two separated spheres bridges the gap", () => {
    const sphereAt = (x: number): OpNode => ({
      op: "translate",
      v: [x, 0, 0],
      child: { op: "sphere", r: 3, segments: 16 },
    });
    const node: OpNode = { op: "hull", children: [sphereAt(0), sphereAt(20)] };
    const mesh = evaluateOpGraph(rc!, node);
    expect(mesh.triangleCount).toBeGreaterThan(0);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      minX = Math.min(minX, mesh.positions[i]);
      maxX = Math.max(maxX, mesh.positions[i]);
    }
    // The hull reaches from the left of the near sphere (~ -3) to the right of
    // the far one (~ 23), bridging the 20-unit gap into one solid
    expect(minX).toBeLessThan(-2.5);
    expect(maxX).toBeGreaterThan(22.5);
    const oneSphere = (4 / 3) * Math.PI * 3 ** 3;
    expect(brepMeshVolume(mesh)).toBeGreaterThan(2 * oneSphere);
  });
});

/** Axis-aligned bounds of a mesh, as [min, max] triples. */
function brepMeshBounds(mesh: { positions: Float32Array }): {
  min: number[];
  max: number[];
} {
  const min = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (let i = 0; i < mesh.positions.length; i += 3)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], mesh.positions[i + a]);
      max[a] = Math.max(max[a], mesh.positions[i + a]);
    }
  return { min, max };
}

describe("B-rep polyhedron sews an explicit solid from its faces", () => {
  test.skipIf(!rc)("a unit tetrahedron sews into a solid of volume 1/6", () => {
    const node: OpNode = {
      op: "polyhedron",
      points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      faces: [3, 0, 2, 1, 3, 0, 1, 3, 3, 1, 2, 3, 3, 2, 0, 3],
    };
    const mesh = evaluateOpGraph(rc!, node);
    // Four planar triangular faces tessellate to exactly four triangles
    expect(mesh.triangleCount).toBe(4);
    expect(brepMeshVolume(mesh)).toBeCloseTo(1 / 6, 5);
  });

  test.skipIf(!rc)(
    "a cube from 6 quad faces keeps each quad a single planar face",
    () => {
      const node: OpNode = {
        op: "polyhedron",
        points: [
          0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1,
          1,
        ],
        faces: [
          4, 0, 3, 2, 1, 4, 4, 5, 6, 7, 4, 0, 1, 5, 4, 4, 3, 7, 6, 2, 4, 0, 4,
          7, 3, 4, 1, 2, 6, 5,
        ],
      };
      const mesh = evaluateOpGraph(rc!, node);
      // Six planar quads, each kept as one B-rep face and tessellating to two
      // triangles, is 12 triangles in total
      expect(mesh.triangleCount).toBe(12);
      const { min, max } = brepMeshBounds(mesh);
      expect(min[0]).toBeCloseTo(0, 5);
      expect(min[1]).toBeCloseTo(0, 5);
      expect(min[2]).toBeCloseTo(0, 5);
      expect(max[0]).toBeCloseTo(1, 5);
      expect(max[1]).toBeCloseTo(1, 5);
      expect(max[2]).toBeCloseTo(1, 5);
      expect(brepMeshVolume(mesh)).toBeCloseTo(1, 5);
    },
  );

  test.skipIf(!rc)(
    "a non-planar face falls back to triangulation and still sews a solid",
    () => {
      // A cube with one corner (vertex 6) pulled out along the diagonal, so the
      // three quad faces that share it are non-planar and must be fanned
      const node: OpNode = {
        op: "polyhedron",
        points: [
          0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1.3, 1.3, 1.3,
          0, 1, 1,
        ],
        faces: [
          4, 0, 3, 2, 1, 4, 4, 5, 6, 7, 4, 0, 1, 5, 4, 4, 3, 7, 6, 2, 4, 0, 4,
          7, 3, 4, 1, 2, 6, 5,
        ],
      };
      const mesh = evaluateOpGraph(rc!, node);
      expect(mesh.triangleCount).toBeGreaterThan(0);
      // The pulled corner grows the solid past the unit cube's volume of 1
      expect(brepMeshVolume(mesh)).toBeGreaterThan(1);
      const { max } = brepMeshBounds(mesh);
      expect(max[0]).toBeCloseTo(1.3, 5);
    },
  );
});
