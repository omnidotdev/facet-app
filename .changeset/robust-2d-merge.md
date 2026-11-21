---
"@omnidotdev/facet": patch
---

Models built from many round-capped strokes (zodiac glyphs, lettering, outlines) no longer fail to build at certain sizes and stroke widths. When the exact sketch merge can't resolve nearly overlapping curves, Facet now falls back to a fine polygon merge instead of erroring, and the polygon merge itself retries on a fine grid when it hits a floating-point edge case.
