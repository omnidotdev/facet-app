# @omnidotdev/facet

## 0.8.0

### Minor Changes

- [#110](https://github.com/omnidotdev/facet-app/pull/110) [`05c787d`](https://github.com/omnidotdev/facet-app/commit/05c787d792833aa011c966dad95e3873d08f0452) Thanks [@coopbri](https://github.com/coopbri)! - Add an "Upgrade to Pro" link for free-tier users in the Describe a part panel, and point "Buy credits" at the credits section of the personal workspace Facet bills. The panel now refreshes your balance and plan when you return to the tab, clears the out-of-credits notice once credits land, and tells you when the render check or refine after a successful draft was stopped by credits, plan, or a usage limit (the draft is always kept). The render check now works on more GPUs and when the 3D view is hidden on narrow screens. Sign-in now asks for workspace access, and sessions from before that change are asked to sign in again.

- [#112](https://github.com/omnidotdev/facet-app/pull/112) [`65671fe`](https://github.com/omnidotdev/facet-app/commit/65671fe8c49d5b34fd672b7210a5863399ffd07d) Thanks [@coopbri](https://github.com/coopbri)! - Managed AI generation is now for paying customers: Facet Pro, or a workspace that has bought Omni credits (Facet Free no longer includes managed credits). Signed-in users who have not paid yet now see the Describe a part panel in a paid-access state that explains AI generation uses Omni credits and offers "Buy credits", "Upgrade to Pro", and "Use your own Synapse key", so you can still generate with your own key. After you buy credits or upgrade and return to the tab, the panel switches to generating on its own. A generation refused because you have not paid yet now opens that same state instead of saying you are out of credits.

- [#114](https://github.com/omnidotdev/facet-app/pull/114) [`6fc9824`](https://github.com/omnidotdev/facet-app/commit/6fc9824e6f6e2e5283c5ce41462acad9d87e5ef7) Thanks [@coopbri](https://github.com/coopbri)! - AI generation now runs in the background. Generate queues your part and frees the panel right away, so you can keep modeling, close the panel, or even leave the page while it generates. A queue in the "Describe a part" panel shows each part as Queued, Generating, Ready, or Failed, and the button shows how many are generating or ready. Open a ready part to load it into a new model tab (it is still checked and refined as before), retry a failed one, or discard what you do not need. A short message lets you know when a part finishes while you are elsewhere in the app. Ready parts wait for up to 24 hours. Generating with your own Synapse key works as before.

- [#116](https://github.com/omnidotdev/facet-app/pull/116) [`c4c886a`](https://github.com/omnidotdev/facet-app/commit/c4c886a87c41ad3adb2f8778d0003920a9b603f9) Thanks [@coopbri](https://github.com/coopbri)! - Offer free AI credits when generation needs payment

  The paid-access state now links to the account hub with "Add a card to unlock 50 free AI credits a month" while the gateway reports card-verified free AI credits are offered (never while the offer is off).

- [#125](https://github.com/omnidotdev/facet-app/pull/125) [`73e6fe1`](https://github.com/omnidotdev/facet-app/commit/73e6fe1b8dcb32996e5949be9dc2355df06f9cfc) Thanks [@coopbri](https://github.com/coopbri)! - Shuffle the example prompts in Describe a part

  The Describe a part dialog now shows three example prompts at a time, drawn in a random order each time it opens, with **More ideas** to see others from a larger set (a box with a lid, a cable clip, a wall hook, a spacer ring, and more). Picking one drafts it into the prompt and focuses it so you can edit it first; nothing generates until you select Generate. The examples hide once you type and come back if you clear the prompt.

- [#118](https://github.com/omnidotdev/facet-app/pull/118) [`7df413c`](https://github.com/omnidotdev/facet-app/commit/7df413c44a2560fd5040752bc68a783e0ced86bb) Thanks [@coopbri](https://github.com/coopbri)! - The 3D preview now falls back to WebGL when the browser has no working WebGPU (common in Chromium-based browsers on Linux), instead of showing a notice. A label in the corner of the viewport shows which renderer is drawing, and Settings has a Renderer choice (Auto, WebGPU, WebGL) for when WebGPU is present but the preview stays blank or black.

### Patch Changes

- [#113](https://github.com/omnidotdev/facet-app/pull/113) [`eb8fbf3`](https://github.com/omnidotdev/facet-app/commit/eb8fbf36108961e221c93630880e4086e517709b) Thanks [@coopbri](https://github.com/coopbri)! - Call the shared balance "AI credits" in the AI panel: it shows "N AI credits, shared across Omni products", and the paid-access notice says "Generation uses AI credits."

- [#119](https://github.com/omnidotdev/facet-app/pull/119) [`4b9c62a`](https://github.com/omnidotdev/facet-app/commit/4b9c62a7ed913f25efa945d32e54a9163c39a189) Thanks [@coopbri](https://github.com/coopbri)! - On desktop Linux, the Auto renderer now starts with WebGL, since WebGPU there is still off by default and turning it on often shows a black preview. Pick WebGPU in Settings to use it anyway.

- [#122](https://github.com/omnidotdev/facet-app/pull/122) [`da09e82`](https://github.com/omnidotdev/facet-app/commit/da09e8239306086782b653be92b19e553fddaaef) Thanks [@coopbri](https://github.com/coopbri)! - Dragging a slider on a detailed part no longer freezes the Studio. Parts that use exact geometry (fillets, chamfers, shells, curved sketches) now rebuild in the background, so the cursor, slider, and view stay responsive and the part updates as each rebuild finishes. STEP, STL, and 3MF exports run in the background too.

- [#126](https://github.com/omnidotdev/facet-app/pull/126) [`c9b372a`](https://github.com/omnidotdev/facet-app/commit/c9b372a27c0eb3000c2ccd8a0f77b3d4e4a18019) Thanks [@coopbri](https://github.com/coopbri)! - On a phone, the Describe a part dialog now shows your credit balance above Cancel and Generate instead of squeezing it into a narrow column beside them, and the buttons are easier to tap.

- [#127](https://github.com/omnidotdev/facet-app/pull/127) [`0443f35`](https://github.com/omnidotdev/facet-app/commit/0443f35fe335adb8bb27822579021ebaf79a5d39) Thanks [@coopbri](https://github.com/coopbri)! - Name exported files after the model

  Downloading a model as STL, 3MF, or STEP now names the file after the model's tab (for example `Hex Nut.step`) instead of a generic `facet-model.step`.

- [#124](https://github.com/omnidotdev/facet-app/pull/124) [`fbd2f60`](https://github.com/omnidotdev/facet-app/commit/fbd2f6007357ca032ff0462f8c6e9cf59741727b) Thanks [@coopbri](https://github.com/coopbri)! - Parts now update continuously while you drag a slider. During the drag, sketches built from many pieces rebuild as a fast draft (several times a second instead of about once a second), and the exact part rebuilds when you let go. Exports always use the exact part.

- [#117](https://github.com/omnidotdev/facet-app/pull/117) [`3fcba30`](https://github.com/omnidotdev/facet-app/commit/3fcba30c9e8823bc5e77925ea5136e00dd9b6d8c) Thanks [@coopbri](https://github.com/coopbri)! - Sliders show their units, like "50 mm" or "45°", when a model declares one with `param.number(name, { unit: "mm" })`, and Settings notes that models and exported files are in millimeters.

- [#121](https://github.com/omnidotdev/facet-app/pull/121) [`a657f7f`](https://github.com/omnidotdev/facet-app/commit/a657f7fed2e0339c886ec1fa8090eef70b49aa1c) Thanks [@coopbri](https://github.com/coopbri)! - Move to the `@omnidotdev/providers` v0.2.0 release.

- [#115](https://github.com/omnidotdev/facet-app/pull/115) [`d8de03f`](https://github.com/omnidotdev/facet-app/commit/d8de03fc7b0d9c291b89f893e4fe33b2cdd7da7f) Thanks [@coopbri](https://github.com/coopbri)! - Fix generated code showing the "Generated by Facet AI" header twice after the render check refined a part

## 0.7.0

### Minor Changes

- [#108](https://github.com/omnidotdev/facet-app/pull/108) [`f5ee079`](https://github.com/omnidotdev/facet-app/commit/f5ee079cb5192a1270e6992721dc378ffd7697c4) Thanks [@coopbri](https://github.com/coopbri)! - Add an AI training-data opt-in to the account menu. A signed-in user who can use managed generation sees a clearly labeled, off-by-default switch to share their prompts and generated models so Facet's AI can keep improving, with a plain-language explanation and a link to the privacy policy. Turning it on is a single affirmative action; turning it off stops collection and deletes what was shared. The toggle reflects and updates the gateway's record of the user's consent.

## 0.6.0

### Minor Changes

- [#106](https://github.com/omnidotdev/facet-app/pull/106) [`1c1c5ab`](https://github.com/omnidotdev/facet-app/commit/1c1c5ab9afc9dae1afad0830b083ba8a3f8c3a4a) Thanks [@coopbri](https://github.com/coopbri)! - Wire the generation-trace telemetry through the describe-a-part flow so the AI loop is measurable end to end.

  - The gateway's `generationId` is captured from a generation and threaded through the vision critique and the automatic refine pass, so a draft and its refine read as one correlated chain instead of two unlinked generations.
  - On a successful generation the result's disposition is reported as `kept` (the implicit accept, since the code is applied to the editor), correlated to the generation. Pure telemetry: fire-and-forget, metadata only, and a dropped report never affects the generation.

  Nothing new is stored or shown to the user; richer dispositions (discarded, regenerated) await a result-review affordance.

## 0.5.0

### Minor Changes

- [#104](https://github.com/omnidotdev/facet-app/pull/104) [`399d049`](https://github.com/omnidotdev/facet-app/commit/399d04917ff919d92d324da5d86298ddb584319b) Thanks [@coopbri](https://github.com/coopbri)! - feat(ai): clearer generation progress and credit context in the describe panel

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

## 0.4.0

### Minor Changes

- [#100](https://github.com/omnidotdev/facet-app/pull/100) [`e85ad8a`](https://github.com/omnidotdev/facet-app/commit/e85ad8aef5a3c69a7eb36135a4f0b675ae2ec810) Thanks [@coopbri](https://github.com/coopbri)! - Show the pooled Omni credit balance in the describe-a-part panel, labeled as shared across Omni and formatted with the shared credit helper. After each managed generation the panel refetches the balance instead of subtracting locally, and the credits a generation spent come from the balance change. The out-of-credits state now links to buy credits.

## 0.3.0

### Minor Changes

- [#96](https://github.com/omnidotdev/facet-app/pull/96) [`e8cfde4`](https://github.com/omnidotdev/facet-app/commit/e8cfde42b597595e1904f48598f0142eca6b02f2) Thanks [@coopbri](https://github.com/coopbri)! - Auto-refine a generation the vision critic judges off, instead of showing the user the raw critique. After a "Describe a part" miss, the Studio regenerates once with the critic's suggestion (bounded to one pass, best-effort, and it keeps the good first model if the refine itself fails) and shows a plain "Refining for accuracy" status. Removes the under-the-hood "Suggested refinement" instruction text (an implementation-detail leak) and fixes the notice contrast. The generate client and the generate-and-run loop now forward a `refine` (`{ code, suggestion }`) to the gateway's new refine path.

- [#95](https://github.com/omnidotdev/facet-app/pull/95) [`6a7e911`](https://github.com/omnidotdev/facet-app/commit/6a7e911135425694fab2ed5dbd332fefc02417b1) Thanks [@coopbri](https://github.com/coopbri)! - Ground AI generation with a vision critique. After a successful "Describe a part" generation, the Studio captures the 3D render and sends it to the gateway's `/critique` route; when the vision model judges the result does not match the request, its suggested refinement is surfaced in the panel so the user can act on it instead of accepting a wrong part. Best-effort and gated: if the viewport cannot be captured (no WebGPU) or the critique fails, it degrades silently to the prior generate-and-run behavior. Adds `Viewport.capture()`, a `StudioHandle.capture`, the `/critique` client, and a pure bounded auto-refine loop (for a later pass).

- [#97](https://github.com/omnidotdev/facet-app/pull/97) [`a04fb7a`](https://github.com/omnidotdev/facet-app/commit/a04fb7a4d8641a5d01dd76e1108844332e922133) Thanks [@coopbri](https://github.com/coopbri)! - Add an "Import art" Studio control that brings an SVG or image into a new tab as an extruded part. An SVG (file or URL) is parsed directly; a raster (PNG/JPG/...) is traced to an outline in the browser. The art is normalized (scaled and centered) and dropped in as a runnable `importSvg` snippet.

  Under it: a dependency-free raster vectorizer (`traceImageData`, `src/facet/traceImage.ts`) thresholds a bitmap to an ink mask and traces the ink/background boundary along the pixel grid into closed, oriented SVG contours (holes included, via opposite winding), and an art normalizer (`normalizePathData`/`buildImportSnippet`, `src/facet/importArt.ts`). URL import goes through the gateway's guarded proxy; file import works offline.

- [#97](https://github.com/omnidotdev/facet-app/pull/97) [`a04fb7a`](https://github.com/omnidotdev/facet-app/commit/a04fb7a4d8641a5d01dd76e1108844332e922133) Thanks [@coopbri](https://github.com/coopbri)! - `importSvg` now accepts a whole `<svg>…</svg>` document, not just a single path `d` string, so an SVG file can be pasted in directly. Every `<path>` plus the basic shapes (`<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`) is imported, with element and nested-group `transform` attributes (`translate`/`scale`/`rotate`/`matrix`/`skew`) baked into the coordinates. A bare `d` string still works unchanged. `viewBox`, CSS/`style`, `<use>`, gradients and text are not interpreted, and the authored coordinates are used as-is, so `.scale(...)`/`.translate(...)` the result to size and place it.

  The code editor also soft-wraps long lines now, so a pasted SVG path or other long literal stays readable instead of forcing horizontal scroll.

### Patch Changes

- [#91](https://github.com/omnidotdev/facet-app/pull/91) [`dd4af8a`](https://github.com/omnidotdev/facet-app/commit/dd4af8adf0ea6d07f5a7d246d9a011ba8a1c540e) Thanks [@coopbri](https://github.com/coopbri)! - Show the remaining monthly AI credit balance in the Describe-a-part panel ("N credits left this month"), so the per-generation credit cost has context instead of being a bare number. The balance comes from the gateway's capability probe, updates after each generation without a re-fetch, and is simply omitted when unavailable.

- [#89](https://github.com/omnidotdev/facet-app/pull/89) [`0282c24`](https://github.com/omnidotdev/facet-app/commit/0282c241645697f8055679dcd4c68663f221924e) Thanks [@coopbri](https://github.com/coopbri)! - Make AI-generated models self-documenting and de-jargon the generation copy. Generated code now opens with a provenance header recording that Facet AI wrote it, the date, and the prompt it came from, so the model explains itself and survives export. The success toast no longer surfaces the internal "repair" loop (an implementation detail with no user meaning); it reports only the credit cost.

- [#89](https://github.com/omnidotdev/facet-app/pull/89) [`0282c24`](https://github.com/omnidotdev/facet-app/commit/0282c241645697f8055679dcd4c68663f221924e) Thanks [@coopbri](https://github.com/coopbri)! - Version the desktop installers from the single source of truth. The release version sync wrote `src-tauri/Cargo.toml` but not `src-tauri/tauri.conf.json`, whose `version` drives the bundle and the app's reported version, so a tagged release could ship installers still carrying the previous number. The sync now updates both, keeping the tag, the installers, and the in-app version in lockstep.

- [#92](https://github.com/omnidotdev/facet-app/pull/92) [`c4175a4`](https://github.com/omnidotdev/facet-app/commit/c4175a4ca8faf44a7af1768fb35fc306f8134ad4) Thanks [@coopbri](https://github.com/coopbri)! - Theme the shared Thornberry components (the command palette and the Describe-a-part panel) with Facet's Studio palette. These components render through a portal to `<body>`, outside the `.facet-app` subtree, so they were falling back to Sigil's default violet/neutral tokens instead of Facet's blue/orange theme. The Sigil semantic tokens are now set to Facet's brand on `:root` (light) and `[data-theme="dark"]` (dark) so every shared component inherits the Studio look; the components already theme purely through those tokens, so this is the canonical, downstream-friendly fix.

## 0.2.1

### Patch Changes

- [#87](https://github.com/omnidotdev/facet-app/pull/87) [`25df57e`](https://github.com/omnidotdev/facet-app/commit/25df57eb67d6ad78b41b2025e18484b8e7b01977) Thanks [@coopbri](https://github.com/coopbri)! - Version the desktop installers from the single source of truth. The release version sync wrote `src-tauri/Cargo.toml` but not `src-tauri/tauri.conf.json`, whose `version` drives the bundle and the app's reported version, so a tagged release could ship installers still carrying the previous number. The sync now updates both, keeping the tag, the installers, and the in-app version in lockstep.

## 0.2.0

### Minor Changes

- [#84](https://github.com/omnidotdev/facet-app/pull/84) [`65f170d`](https://github.com/omnidotdev/facet-app/commit/65f170dac7e22cc64ead9181b6eb03f2b70dd276) Thanks [@coopbri](https://github.com/coopbri)! - Add 2D sketch transforms: `translate` (and its `move` alias), `rotate`, `scale`, and `mirror` on a sketch. They position and reflect a profile in its own plane, so you can build one half of a symmetric outline and `mirror` it to get the whole (for example `half.union(half.mirror([1, 0]))`). `rotate` and `scale` work about the origin, and `mirror` reflects across the line through the origin with the given normal (`[1, 0]` flips X, `[0, 1]` flips Y). A transformed simple profile (circle, rectangle, polygon) still tessellates in the fast mesh and WASM kernels; a transformed curved or combined profile builds in the exact B-rep kernel.

- [#32](https://github.com/omnidotdev/facet-app/pull/32) [`bbe3d93`](https://github.com/omnidotdev/facet-app/commit/bbe3d930d0b0c0793b878ad71285873f35accf23) Thanks [@coopbri](https://github.com/coopbri)! - Add AI-assisted generation, offline support, and a desktop release pipeline. A "Describe a part" panel turns a plain-English prompt into Facet code, runs it, and repairs it on error; bring-your-own-key needs no account, and signed-in managed generation is credit-metered with an upgrade link to the billing hub. The web app is now an offline-first PWA, so local modeling and STL/3MF/STEP export work with no network after first load. Tagging a release (via the Changesets flow) builds native desktop installers (macOS, Windows, Linux).

- [#24](https://github.com/omnidotdev/facet-app/pull/24) [`0063d89`](https://github.com/omnidotdev/facet-app/commit/0063d897188735f88e300339cbe9c4b63bb11831) Thanks [@coopbri](https://github.com/coopbri)! - Add an exact-geometry B-rep kernel (OpenCascade/OCCT compiled to WebAssembly) alongside the existing TypeScript mesh and Rust/WASM kernels. It evaluates the op-graph into exact geometry with smooth normals, and loads in the browser on demand, only the first time a model uses it.

  Three B-rep-only operations build on it: `.fillet(radius)` rounds every edge, `.chamfer(size)` bevels every edge, and `.shell(thickness)` hollows a solid by opening its top face. When a model uses any of them, the Studio switches to the B-rep kernel and renders automatically instead of erroring; the lightweight mesh kernel stays the default for everything else.

  Export the exact B-rep solid as STEP (ISO-10303 AP242), beside the existing STL and 3MF.

  The op-graph IR is now generated from a single ODK contract into both TypeScript and Rust, so the kernels share one definition rather than two hand-maintained copies.

- [#81](https://github.com/omnidotdev/facet-app/pull/81) [`e71dd99`](https://github.com/omnidotdev/facet-app/commit/e71dd99e12d6bb5dc64463139e04488ffdfda3c4) Thanks [@coopbri](https://github.com/coopbri)! - Add `cone(r1, r2, h)`, a truncated cone or tapered cylinder. Set `r2` to 0 for a sharp apex. It builds in all three kernels: the mesh and Rust/WASM kernels tessellate it, and the exact B-rep kernel revolves its profile.

- [#81](https://github.com/omnidotdev/facet-app/pull/81) [`e71dd99`](https://github.com/omnidotdev/facet-app/commit/e71dd99e12d6bb5dc64463139e04488ffdfda3c4) Thanks [@coopbri](https://github.com/coopbri)! - Add `hull(...shapes)`, the convex hull of its children. It runs in all three kernels from one shared hull routine, and the exact B-rep kernel returns a filletable, STEP-exportable solid.

- [#81](https://github.com/omnidotdev/facet-app/pull/81) [`e71dd99`](https://github.com/omnidotdev/facet-app/commit/e71dd99e12d6bb5dc64463139e04488ffdfda3c4) Thanks [@coopbri](https://github.com/coopbri)! - Add `polyhedron(points, faces)`, a solid defined by explicit vertices and faces. Faces may be triangles or convex n-gons; the exact B-rep kernel keeps each planar face whole, while the mesh and Rust/WASM kernels tessellate it.

- [#21](https://github.com/omnidotdev/facet-app/pull/21) [`7bf283c`](https://github.com/omnidotdev/facet-app/commit/7bf283c6cdcd4ce2a2da51c8941297aaa9aff7e4) Thanks [@coopbri](https://github.com/coopbri)! - Render the Studio 3D preview on a native WebGPU (TypeGPU) stack, replacing the previous WebGL renderer. The 3D preview now requires a browser with WebGPU (a recent version of Chrome, Edge, Safari, or Firefox); code authoring and STL/3MF export keep working without it.

### Patch Changes

- [#82](https://github.com/omnidotdev/facet-app/pull/82) [`b69040e`](https://github.com/omnidotdev/facet-app/commit/b69040eff1e645a6ac2e268b376209236ced8e69) Thanks [@coopbri](https://github.com/coopbri)! - Make `importSvg` robust on complex paths: cubic, quadratic, and elliptical-arc segments are flattened to dense polylines before the sketch is built. This removes the self-touching artifacts intricate glyphs and logos could produce, while staying visually identical at a glyph's scale.
