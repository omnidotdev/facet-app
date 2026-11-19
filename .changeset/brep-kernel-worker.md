---
"@omnidotdev/facet": patch
---

Dragging a slider on a detailed part no longer freezes the Studio. Parts that use exact geometry (fillets, chamfers, shells, curved sketches) now rebuild in the background, so the cursor, slider, and view stay responsive and the part updates as each rebuild finishes. STEP, STL, and 3MF exports run in the background too.
