import { describe, expect, test } from "bun:test";

import { evaluateOpGraph } from "./brepKernel";

import type { OpNode } from "./opgraph";

/**
 * Load OCCT the way a non-Vite runtime must (see brepKernel.test). The SVG
 * builder produces a replicad Drawing, so it can only be exercised end to end
 * with the B-rep kernel; without OCCT the suite skips rather than fails.
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

const extrudeSvg = (d: string): OpNode => ({
  op: "extrude",
  height: 4,
  twist: 0,
  scale: 1,
  child: { op: "svg2d", path: d },
});

describe("importSvg / svg2d", () => {
  test.skipIf(!rc)("a lines-only path extrudes to a solid", () => {
    const mesh = evaluateOpGraph(rc!, extrudeSvg("M0 0 L20 0 L20 20 L0 20 Z"));
    // A box floor is 12 triangles
    expect(mesh.triangleCount).toBeGreaterThanOrEqual(12);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
  });

  test.skipIf(!rc)("cubic beziers build a curved solid", () => {
    const mesh = evaluateOpGraph(
      rc!,
      extrudeSvg("M0 0 C10 0 10 20 0 20 C-10 20 -10 0 0 0 Z"),
    );
    expect(mesh.triangleCount).toBeGreaterThan(12);
  });

  test.skipIf(!rc)("relative commands and compact number packing parse", () => {
    const mesh = evaluateOpGraph(rc!, extrudeSvg("m0 0 l20 0 l0 20 l-20 0z"));
    expect(mesh.triangleCount).toBeGreaterThanOrEqual(12);
  });

  test.skipIf(!rc)("an opposite-wound subpath is cut as a hole", () => {
    const ring = evaluateOpGraph(
      rc!,
      extrudeSvg("M0 0 L30 0 L30 30 L0 30 Z M8 8 L8 22 L22 22 L22 8 Z"),
    );
    const solid = evaluateOpGraph(rc!, extrudeSvg("M0 0 L30 0 L30 30 L0 30 Z"));
    // The hole adds interior walls, so the ring tessellates to more triangles
    expect(ring.triangleCount).toBeGreaterThan(solid.triangleCount);
  });

  test.skipIf(!rc)("the Y axis is flipped so the art is not inverted", () => {
    // In SVG this L runs downward (y grows down); after the flip its body sits
    // at y <= 0, so the mesh's Y extent is on the negative side of the origin
    const mesh = evaluateOpGraph(rc!, extrudeSvg("M0 0 L4 0 L4 20 L0 20 Z"));
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 1; i < mesh.positions.length; i += 3) {
      minY = Math.min(minY, mesh.positions[i]);
      maxY = Math.max(maxY, mesh.positions[i]);
    }
    expect(minY).toBeLessThan(-10);
    expect(maxY).toBeLessThanOrEqual(0.001);
  });

  test.skipIf(!rc)("an empty path is rejected with a clear message", () => {
    expect(() => evaluateOpGraph(rc!, extrudeSvg("   "))).toThrow();
  });
});
