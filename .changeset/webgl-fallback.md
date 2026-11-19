---
"@omnidotdev/facet": minor
---

The 3D preview now falls back to WebGL when the browser has no working WebGPU (common in Chromium-based browsers on Linux), instead of showing a notice. A label in the corner of the viewport shows which renderer is drawing, and Settings has a Renderer choice (Auto, WebGPU, WebGL) for when WebGPU is present but the preview stays blank or black.
