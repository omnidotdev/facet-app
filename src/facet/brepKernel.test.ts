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
