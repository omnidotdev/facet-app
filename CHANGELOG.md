# @omnidotdev/facet

## 0.2.0

### Minor Changes

- [#32](https://github.com/omnidotdev/facet-app/pull/32) [`bbe3d93`](https://github.com/omnidotdev/facet-app/commit/bbe3d930d0b0c0793b878ad71285873f35accf23) Thanks [@coopbri](https://github.com/coopbri)! - Add AI-assisted generation, offline support, and a desktop release pipeline. A "Describe a part" panel turns a plain-English prompt into Facet code, runs it, and repairs it on error; bring-your-own-key needs no account, and signed-in managed generation is credit-metered with an upgrade link to the billing hub. The web app is now an offline-first PWA, so local modeling and STL/3MF/STEP export work with no network after first load. Tagging a release (via the Changesets flow) builds native desktop installers (macOS, Windows, Linux).

- [#24](https://github.com/omnidotdev/facet-app/pull/24) [`0063d89`](https://github.com/omnidotdev/facet-app/commit/0063d897188735f88e300339cbe9c4b63bb11831) Thanks [@coopbri](https://github.com/coopbri)! - Add an exact-geometry B-rep kernel (OpenCascade/OCCT compiled to WebAssembly) alongside the existing TypeScript mesh and Rust/WASM kernels. It evaluates the op-graph into exact geometry with smooth normals, and loads in the browser on demand, only the first time a model uses it.

  Three B-rep-only operations build on it: `.fillet(radius)` rounds every edge, `.chamfer(size)` bevels every edge, and `.shell(thickness)` hollows a solid by opening its top face. When a model uses any of them, the Studio switches to the B-rep kernel and renders automatically instead of erroring; the lightweight mesh kernel stays the default for everything else.

  Export the exact B-rep solid as STEP (ISO-10303 AP242), beside the existing STL and 3MF.

  The op-graph IR is now generated from a single ODK contract into both TypeScript and Rust, so the kernels share one definition rather than two hand-maintained copies.

- [#81](https://github.com/omnidotdev/facet-app/pull/81) [`e71dd99`](https://github.com/omnidotdev/facet-app/commit/e71dd99e12d6bb5dc64463139e04488ffdfda3c4) Thanks [@coopbri](https://github.com/coopbri)! - Add `cone(r1, r2, h)`, a truncated cone or tapered cylinder. Set `r2` to 0 for a sharp apex. It builds in all three kernels: the mesh and Rust/WASM kernels tessellate it, and the exact B-rep kernel revolves its profile.

- [#81](https://github.com/omnidotdev/facet-app/pull/81) [`e71dd99`](https://github.com/omnidotdev/facet-app/commit/e71dd99e12d6bb5dc64463139e04488ffdfda3c4) Thanks [@coopbri](https://github.com/coopbri)! - Add `hull(...shapes)`, the convex hull of its children. It runs in all three kernels from one shared hull routine, and the exact B-rep kernel returns a filletable, STEP-exportable solid.

- [#81](https://github.com/omnidotdev/facet-app/pull/81) [`e71dd99`](https://github.com/omnidotdev/facet-app/commit/e71dd99e12d6bb5dc64463139e04488ffdfda3c4) Thanks [@coopbri](https://github.com/coopbri)! - Add `polyhedron(points, faces)`, a solid defined by explicit vertices and faces. Faces may be triangles or convex n-gons; the exact B-rep kernel keeps each planar face whole, while the mesh and Rust/WASM kernels tessellate it.

- [#21](https://github.com/omnidotdev/facet-app/pull/21) [`7bf283c`](https://github.com/omnidotdev/facet-app/commit/7bf283c6cdcd4ce2a2da51c8941297aaa9aff7e4) Thanks [@coopbri](https://github.com/coopbri)! - Render the Studio 3D preview on a native WebGPU (TypeGPU) stack, replacing the previous WebGL renderer. The 3D preview now requires a browser with WebGPU (a recent version of Chrome, Edge, Safari, or Firefox); code authoring and STL/3MF export keep working without it.

### Patch Changes

- [#82](https://github.com/omnidotdev/facet-app/pull/82) [`b69040e`](https://github.com/omnidotdev/facet-app/commit/b69040eff1e645a6ac2e268b376209236ced8e69) Thanks [@coopbri](https://github.com/coopbri)! - Make `importSvg` robust on complex paths: cubic, quadratic, and elliptical-arc segments are flattened to dense polylines before the sketch is built. This removes the self-touching artifacts intricate glyphs and logos could produce, while staying visually identical at a glyph's scale.
