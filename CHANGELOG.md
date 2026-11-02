# @omnidotdev/facet

## 0.2.0

### Minor Changes

- [#32](https://github.com/omnidotdev/facet-app/pull/32) [`bbe3d93`](https://github.com/omnidotdev/facet-app/commit/bbe3d930d0b0c0793b878ad71285873f35accf23) Thanks [@coopbri](https://github.com/coopbri)! - Add AI-assisted generation, offline support, and a desktop release pipeline. A "Describe a part" panel turns a plain-English prompt into Facet code, runs it, and repairs it on error; bring-your-own-key needs no account, and signed-in managed generation is credit-metered with an upgrade link to the billing hub. The web app is now an offline-first PWA, so local modeling and STL/3MF/STEP export work with no network after first load. Tagging a release (via the Changesets flow) builds native desktop installers (macOS, Windows, Linux).

- [#24](https://github.com/omnidotdev/facet-app/pull/24) [`0063d89`](https://github.com/omnidotdev/facet-app/commit/0063d897188735f88e300339cbe9c4b63bb11831) Thanks [@coopbri](https://github.com/coopbri)! - Add an exact-geometry B-rep kernel (OpenCascade/OCCT compiled to WebAssembly) alongside the existing TypeScript mesh and Rust/WASM kernels. It evaluates the op-graph into exact geometry with smooth normals, and loads in the browser on demand, only the first time a model uses it.

  Three B-rep-only operations build on it: `.fillet(radius)` rounds every edge, `.chamfer(size)` bevels every edge, and `.shell(thickness)` hollows a solid by opening its top face. When a model uses any of them, the Studio switches to the B-rep kernel and renders automatically instead of erroring; the lightweight mesh kernel stays the default for everything else.

  Export the exact B-rep solid as STEP (ISO-10303 AP242), beside the existing STL and 3MF.

  The op-graph IR is now generated from a single ODK contract into both TypeScript and Rust, so the kernels share one definition rather than two hand-maintained copies.

- [#21](https://github.com/omnidotdev/facet-app/pull/21) [`7bf283c`](https://github.com/omnidotdev/facet-app/commit/7bf283c6cdcd4ce2a2da51c8941297aaa9aff7e4) Thanks [@coopbri](https://github.com/coopbri)! - Render the Studio 3D preview on a native WebGPU (TypeGPU) stack, replacing the previous WebGL renderer. The 3D preview now requires a browser with WebGPU (a recent version of Chrome, Edge, Safari, or Firefox); code authoring and STL/3MF export keep working without it.
