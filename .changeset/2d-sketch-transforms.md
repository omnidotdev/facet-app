---
"@omnidotdev/facet": minor
---

Add 2D sketch transforms: `translate` (and its `move` alias), `rotate`, `scale`, and `mirror` on a sketch. They position and reflect a profile in its own plane, so you can build one half of a symmetric outline and `mirror` it to get the whole (for example `half.union(half.mirror([1, 0]))`). `rotate` and `scale` work about the origin, and `mirror` reflects across the line through the origin with the given normal (`[1, 0]` flips X, `[0, 1]` flips Y). A transformed simple profile (circle, rectangle, polygon) still tessellates in the fast mesh and WASM kernels; a transformed curved or combined profile builds in the exact B-rep kernel.
