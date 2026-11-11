---
"@omnidotdev/facet": minor
---

Add an "Import art" Studio control that brings an SVG or image into a new tab as an extruded part. An SVG (file or URL) is parsed directly; a raster (PNG/JPG/...) is traced to an outline in the browser. The art is normalized (scaled and centered) and dropped in as a runnable `importSvg` snippet.

Under it: a dependency-free raster vectorizer (`traceImageData`, `src/facet/traceImage.ts`) thresholds a bitmap to an ink mask and traces the ink/background boundary along the pixel grid into closed, oriented SVG contours (holes included, via opposite winding), and an art normalizer (`normalizePathData`/`buildImportSnippet`, `src/facet/importArt.ts`). URL import goes through the gateway's guarded proxy; file import works offline.
