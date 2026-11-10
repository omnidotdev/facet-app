---
"@omnidotdev/facet": patch
---

Make AI-generated models self-documenting and de-jargon the generation copy. Generated code now opens with a provenance header recording that Facet AI wrote it, the date, and the prompt it came from, so the model explains itself and survives export. The success toast no longer surfaces the internal "repair" loop (an implementation detail with no user meaning); it reports only the credit cost.
