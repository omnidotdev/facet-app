import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { evaluateOpGraph } from "./brepKernel";

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
    const wasmPath = fileURLToPath(
      import.meta.resolve("replicad-opencascadejs/wasm"),
    );
    const wasmBinary = await readFile(wasmPath);
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
});
