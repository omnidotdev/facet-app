---
"@omnidotdev/facet": minor
---

Ground AI generation with a vision critique. After a successful "Describe a part" generation, the Studio captures the 3D render and sends it to the gateway's `/critique` route; when the vision model judges the result does not match the request, its suggested refinement is surfaced in the panel so the user can act on it instead of accepting a wrong part. Best-effort and gated: if the viewport cannot be captured (no WebGPU) or the critique fails, it degrades silently to the prior generate-and-run behavior. Adds `Viewport.capture()`, a `StudioHandle.capture`, the `/critique` client, and a pure bounded auto-refine loop (for a later pass).
