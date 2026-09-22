# Facet 🔶

Code-first parametric CAD, in the browser. Write a model in code, a solid
geometry (CSG) kernel turns it into a mesh, a 3D viewport shows it live, and you
export a print-ready STL.

Script-based CAD with a real programming language and a serious geometry kernel.

Part of the [Omni](https://omni.dev) ecosystem. Realm: **Fabric**. Brand color:
Facet Amber `#DD6E33`.

## Features

- 🧩 **Write code, get geometry**: primitives, transforms, and boolean ops
  (`union` / `subtract` / `intersect`) that build a serializable op-graph.
- 🎛️ **Live parameters**: declare `param.number(...)` and get sliders that
  reshape the model in real time.
- ⚙️ **Two swappable kernels**: a mesh CSG kernel in TypeScript and a Rust
  kernel compiled to WebAssembly, selectable at runtime.
- 🖥️ **3D viewport**: [Three.js](https://threejs.org), Z-up, flat-shaded facets.
- 📦 **Print-ready export**: STL straight from the browser, ready for a slicer.
- 📱 **Runs anywhere**: a web app, plus native desktop and mobile builds via
  [Tauri](https://v2.tauri.app).

## Quickstart

```bash
bun install
bun run dev        # https://localhost:3000
```

## Dev commands

```bash
bun run dev            # dev server with HMR (https://localhost:3000)
bun test src           # engine unit tests (no browser needed)
bunx tsc --noEmit      # typecheck
bun run check          # Biome lint + format check
bun run knip           # unused code / dependency check
bun run build          # production build -> dist/
bun run preview        # serve the production build locally
```

### Rebuilding the Rust/WASM kernel

The compiled kernel is vendored in `src/wasm`, so day-to-day work needs no Rust
toolchain. To rebuild it you need [`wasm-pack`](https://rustwasm.github.io/wasm-pack):

```bash
bun run wasm:build
```

### Desktop / mobile (Tauri)

```bash
bun run tauri dev             # desktop
bun run tauri:ios:dev         # iOS (after tauri:ios:init)
bun run tauri:android:dev     # Android (after tauri:android:init)
```

## Self-hosting

Facet is a static single-page app; `bun run build` emits `dist/`, which any
static host can serve. The included `Dockerfile` builds it and serves it with
nginx. See the [docs](https://omni.dev/products/facet) for a full guide.

## License

[Apache-2.0](./LICENSE.md).
