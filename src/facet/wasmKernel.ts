import { KernelError } from "./kernel";
import { meshToStlBinary } from "./stl";
import { meshTo3mf } from "./threeMf";

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
      let res: ReturnType<typeof wasm.evaluate>;
      try {
        res = wasm.evaluate(JSON.stringify(node));
      } catch (err) {
        // The Rust kernel rejects exact-geometry ops (fillet/chamfer/shell)
        // with a user-facing "Switch the kernel to B-rep (OCCT)" message thrown
        // as a string; mark those safe to show, but leave any other failure
        // (e.g. a malformed op-graph) as an internal detail
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("B-rep kernel")) throw new KernelError(message);
        throw err;
      }
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
        // The Rust kernel tessellates; STEP needs exact B-rep geometry, so send
        // the user to the kernel that can emit it instead of a mesh
        if (format === "step")
          throw new KernelError(
            "STEP export needs the B-rep kernel. Switch the kernel to B-rep (OCCT).",
          );
        const mesh = evaluate(node);
        if (format === "stl") return meshToStlBinary(mesh);
        if (format === "3mf") return meshTo3mf(mesh);
        throw new Error(`unsupported export format: ${format}`);
      },
    };
  } catch (err) {
    console.warn("Facet Rust/WASM kernel unavailable:", err);
    return null;
  }
}
