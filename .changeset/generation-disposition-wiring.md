---
"@omnidotdev/facet": minor
---

Wire the generation-trace telemetry through the describe-a-part flow so the AI loop is measurable end to end.

- The gateway's `generationId` is captured from a generation and threaded through the vision critique and the automatic refine pass, so a draft and its refine read as one correlated chain instead of two unlinked generations.
- On a successful generation the result's disposition is reported as `kept` (the implicit accept, since the code is applied to the editor), correlated to the generation. Pure telemetry: fire-and-forget, metadata only, and a dropped report never affects the generation.

Nothing new is stored or shown to the user; richer dispositions (discarded, regenerated) await a result-review affordance.
