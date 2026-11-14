---
"@omnidotdev/facet": minor
---

feat(ai): clearer generation progress and credit context in the describe panel

The "Describe a part" panel now communicates what is happening and what it
costs:

- A live, phased status beside the spinner ("Generating your part", "Checking
  the render", "Refining for accuracy") so a multi-step generation reads as
  progress instead of one long frozen spinner.
- The pooled credit balance and an honest, self-calibrating per-part estimate
  (drawn from the last real spend, never a hardcoded guess) now sit in a
  strategic footer slot, right where the user decides to generate.
- "Generation runs through Synapse" is now a clearly styled link to the router.
- Removed the middot separators and the pulsing-dot animation in favor of a
  cleaner, structured layout.
