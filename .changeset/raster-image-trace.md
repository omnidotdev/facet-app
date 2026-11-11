---
"@omnidotdev/facet": minor
---

Add a raster vectorizer (`traceImageData`, `src/facet/traceImage.ts`): threshold a PNG/JPG bitmap to an ink mask and trace the ink/background boundary along the pixel grid into closed, oriented SVG contours (holes included, via opposite winding) that flow straight into `importSvg`. Pure and dependency-free, with unit coverage. This is the engine for importing a raster symbol/logo; the Studio UI that picks a file or URL and inserts the generated `importSvg(...)` is a follow-up.
