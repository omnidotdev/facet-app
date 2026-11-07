---
"@omnidotdev/facet": minor
---

Add `polyhedron(points, faces)`, a solid defined by explicit vertices and faces (OpenSCAD's `polyhedron`). Faces may be triangles or convex n-gons; the exact B-rep kernel keeps each planar face whole, while the mesh and Rust/WASM kernels tessellate it.
