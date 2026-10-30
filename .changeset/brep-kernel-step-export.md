---
"@omnidotdev/facet": minor
---

Add an exact-geometry B-rep kernel (OpenCascade/OCCT compiled to WebAssembly) alongside the existing TypeScript mesh and Rust/WASM kernels. It evaluates the op-graph into exact geometry with smooth normals, and loads in the browser on demand, only the first time a model uses it.

Three B-rep-only operations build on it: `.fillet(radius)` rounds every edge, `.chamfer(size)` bevels every edge, and `.shell(thickness)` hollows a solid by opening its top face. When a model uses any of them, the Studio switches to the B-rep kernel and renders automatically instead of erroring; the lightweight mesh kernel stays the default for everything else.

Export the exact B-rep solid as STEP (ISO-10303 AP242), beside the existing STL and 3MF.

The op-graph IR is now generated from a single ODK contract into both TypeScript and Rust, so the kernels share one definition rather than two hand-maintained copies.
