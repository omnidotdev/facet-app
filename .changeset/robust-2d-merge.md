---
"@omnidotdev/facet": patch
---

Models built from many round-capped strokes (zodiac glyphs, lettering, outlines) build reliably at any size and stroke width:

- When the exact sketch merge can't resolve nearly overlapping curves, Facet falls back to a fine polygon merge instead of failing the model.
- The exact merge can also go wrong silently and leave a pinhole the sketch never had. Facet now cross-checks every merged profile before extruding or revolving it and uses the polygon merge when the two disagree.
- The polygon merge retries on a fine grid when it hits a floating-point edge case, which also keeps live slider previews from failing.
