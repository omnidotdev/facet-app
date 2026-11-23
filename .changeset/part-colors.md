---
"@omnidotdev/facet": patch
---

Color your parts. `.color("gold")`, `.color("#1d3557")`, or `.color([1, 0.5, 0])` paints a part in the 3D view, and a 3MF export writes each color as its own part of one object, so a multi-color printer can print each part in its own filament. Differently colored parts stay separate, a cut goes through every colored part, and an inner color wins over an outer one. The new Two-color coaster example shows an inlay: a pocket cut into the base and filled with a second color.
