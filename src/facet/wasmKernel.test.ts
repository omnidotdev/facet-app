import { describe, expect, test } from "bun:test";

import { cube } from "./api";
import { loadWasmKernel } from "./wasmKernel";

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
});
