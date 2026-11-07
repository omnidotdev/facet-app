---
"@omnidotdev/facet": patch
---

Make `importSvg` robust on complex paths: cubic, quadratic, and elliptical-arc segments are flattened to dense polylines before the sketch is built. This removes the self-touching artifacts intricate glyphs and logos could produce, while staying visually identical at a glyph's scale.
