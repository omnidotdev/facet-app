---
"@omnidotdev/facet": minor
---

Add `cone(r1, r2, h)`, a truncated cone or tapered cylinder (OpenSCAD's `cylinder(r1, r2, h)`). Set `r2` to 0 for a sharp apex. It builds in all three kernels: the mesh and Rust/WASM kernels tessellate it, and the exact B-rep kernel revolves its profile.
