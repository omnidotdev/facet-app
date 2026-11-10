---
"@omnidotdev/facet": patch
---

Theme the shared Thornberry components (the command palette and the Describe-a-part panel) with Facet's Studio palette. These components render through a portal to `<body>`, outside the `.facet-app` subtree, so they were falling back to Sigil's default violet/neutral tokens instead of Facet's blue/orange theme. The Sigil semantic tokens are now set to Facet's brand on `:root` (light) and `[data-theme="dark"]` (dark) so every shared component inherits the Studio look; the components already theme purely through those tokens, so this is the canonical, downstream-friendly fix.
