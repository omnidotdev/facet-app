---
"@omnidotdev/facet": minor
---

Type exact parameter values. Click a slider's value (or Tab to it) and type a number, and the model rebuilds with exactly that value, even one the slider's step can't reach. Simple math works too ("50/2", "12 + 3.5"), and so does the unit ("25mm"). Enter applies, Esc cancels, and the arrow keys step like the slider (Shift for ten steps). Values outside a parameter's range are clamped to it, and anything that isn't a number is flagged and put back.
