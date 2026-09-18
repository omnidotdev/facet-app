import { meshToStlBinary } from "./stl";

import type { ExportFormat, Kernel, Mesh } from "./kernel";
import type { OpNode } from "./opgraph";

/**
 * Load the Rust geometry kernel compiled to WebAssembly and adapt it to the
 * Kernel interface. Returns null if the wasm bundle is not present (e.g. it
 * hasn't been built), so the app runs fine on the TypeScript kernel alone.
 */
export async function loadWasmKernel(): Promise<Kernel | null> {
  try {
    const wasm = await import("../wasm/facet_kernel.js");
    await wasm.default();

    const evaluate = (node: OpNode): Mesh => {
      const res = wasm.evaluate(JSON.stringify(node));
      const mesh: Mesh = {
        positions: res.positions,
        normals: res.normals,
        triangleCount: res.triangleCount,
      };
      res.free();
      return mesh;
    };

    return {
      name: wasm.name(),
      evaluate,
      export: (node: OpNode, format: ExportFormat): Uint8Array => {
        if (format !== "stl")
          throw new Error(`unsupported export format: ${format}`);
        return meshToStlBinary(evaluate(node));
      },
    };
  } catch (err) {
    console.warn("Facet Rust/WASM kernel unavailable:", err);
    return null;
  }
}
