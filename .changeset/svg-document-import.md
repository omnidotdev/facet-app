---
"@omnidotdev/facet": minor
---

`importSvg` now accepts a whole `<svg>…</svg>` document, not just a single path `d` string, so an SVG file can be pasted in directly. Every `<path>` plus the basic shapes (`<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`) is imported, with element and nested-group `transform` attributes (`translate`/`scale`/`rotate`/`matrix`/`skew`) baked into the coordinates. A bare `d` string still works unchanged. `viewBox`, CSS/`style`, `<use>`, gradients and text are not interpreted, and the authored coordinates are used as-is, so `.scale(...)`/`.translate(...)` the result to size and place it.

The code editor also soft-wraps long lines now, so a pasted SVG path or other long literal stays readable instead of forcing horizontal scroll.
