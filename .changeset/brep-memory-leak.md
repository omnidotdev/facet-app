---
"@omnidotdev/facet": patch
---

The B-rep kernel no longer leaks memory as a model rebuilds. Models built from many 2D strokes, like the zodiac keychains, used to grow memory by about 10 to 20 MB on every slider change until the tab slowed down or ran out. Rebuilds now reuse the same memory, so a long editing session stays as fast as the first build.
