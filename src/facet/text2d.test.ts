import { describe, expect, test } from "bun:test";

import { evaluateOpGraph } from "./brepKernel";

import type { OpNode } from "./opgraph";

/**
 * text() renders through the bundled font. loadBrepKernel loads it in the
 * browser; a direct-kernel test must load it itself, so these tests both load
 * OCCT and the font (skipping if either is unavailable here).
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
    const font = await Bun.file(
      new URL("../fonts/LiberationSans-Regular.ttf", import.meta.url).pathname,
    ).arrayBuffer();
    await rc.loadFont(font);
    return rc;
  } catch (err) {
    console.warn("OCCT/font unavailable under the test runner, skipping:", err);
    return null;
  }
}

const rc = await loadReplicad();

const extrudeText = (text: string, size = 10): OpNode => ({
  op: "extrude",
  height: 3,
  twist: 0,
  scale: 1,
  child: { op: "text2d", text, size },
});

describe("text() / text2d", () => {
  test.skipIf(!rc)("extrudes a line of text into solid letters", () => {
    const mesh = evaluateOpGraph(rc!, extrudeText("A8"));
    // Letter outlines (with the counter of A and 8 as holes) tessellate richly
    expect(mesh.triangleCount).toBeGreaterThan(50);
    expect(mesh.positions.length).toBe(mesh.triangleCount * 9);
  });

  test.skipIf(!rc)("size scales the glyphs (bigger text, wider extent)", () => {
    const widthOf = (node: OpNode) => {
      const m = evaluateOpGraph(rc!, node);
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < m.positions.length; i += 3) {
        min = Math.min(min, m.positions[i]);
        max = Math.max(max, m.positions[i]);
      }
      return max - min;
    };
    expect(widthOf(extrudeText("W", 20))).toBeGreaterThan(
      widthOf(extrudeText("W", 10)),
    );
  });
});
