# Facet 🔶

Code-first parametric CAD. Write a model in TypeScript, a mesh/CSG kernel turns
it into geometry, and a WebGPU/WebGL viewport shows it live. Export STL.

"OpenSCAD, but with a proper programming language and a serious kernel."

Realm: **FABRIC** (content creation + design), alongside Foundry. Brand color:
Facet Amber `#DD6E33` on Blueprint Ink `#122A43`.

## Status: P1 (MVP)

This is the first vertical slice from `plans/2026-09-17-code-cad-design.md`:

- **Authoring API** (`src/facet/api.ts`) - `cube`, `sphere`, `cylinder`,
  transforms, and boolean ops, building a serializable **op-graph**.
- **Kernel** (`src/facet/meshKernel.ts`) - a BSP-tree CSG kernel in TypeScript
  behind a stable `Kernel` interface (`src/facet/kernel.ts`). The P2 Rust/WASM
  B-rep kernel drops in here.
- **Viewport** (`src/viewport.ts`) - Three.js, Z-up, flat-shaded facets.
- **Editor** (`src/main.ts`) - live re-run on edit, examples, STL export.

## Run

```bash
bun install
bun run dev      # http://localhost:5180
bun test         # engine unit tests (no browser needed)
bun run typecheck
```

## Write a model

A model is code that returns a shape:

```ts
const base = cube([40, 40, 5], { center: false });
const hole = cylinder(3.2, 20, { segments: 32 });
return base.subtract(hole.translate(20, 20, 2.5));
```

## Roadmap (see design doc)

- **P2** - Rust `truck` B-rep kernel: exact geometry, fillets/chamfers, STEP export.
- **P3** - npm part libraries, Foundry publish/print, Gatekeeper auth, Aether tiers.
- **P4** - WebGPU heavy tessellation, collaborative editing, Rust authoring hatch.
