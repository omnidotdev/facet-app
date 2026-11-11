---
"@omnidotdev/facet": minor
---

Auto-refine a generation the vision critic judges off, instead of showing the user the raw critique. After a "Describe a part" miss, the Studio regenerates once with the critic's suggestion (bounded to one pass, best-effort, and it keeps the good first model if the refine itself fails) and shows a plain "Refining for accuracy" status. Removes the under-the-hood "Suggested refinement" instruction text (an implementation-detail leak) and fixes the notice contrast. The generate client and the generate-and-run loop now forward a `refine` (`{ code, suggestion }`) to the gateway's new refine path.
