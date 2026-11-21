---
"@omnidotdev/facet": patch
---

Fix STL and 3MF exports so every part reaches the slicer as one closed solid. Holes such as a keychain's ring hole no longer get filled in when a 3MF is sliced.

- 3MF and STL exports are now watertight, so slicers no longer have to repair them.
- Extruded and revolved parts built with the TS or Rust kernel no longer export inside-out. This was most visible with clockwise or mirrored profiles, downward extrudes, and negative revolve angles.
- A twisted extrude can now be combined with other shapes in the TS and Rust kernels instead of failing.
