# Facet

Frontend application for Facet, code-first parametric CAD in the browser: write a model in code, a solid-geometry (CSG) kernel turns it into a mesh, a 3D viewport shows it live, and you export a print-ready STL or 3MF. Built on [TanStack Router](https://tanstack.com/router) and [Tauri](https://v2.tauri.app) (React), with a TypeScript CSG kernel and a Rust kernel compiled to [WebAssembly](https://webassembly.org), rendered with [Three.js](https://threejs.org).

Product documentation lives in [Fabric](https://docs.omni.dev/products/facet). This README only covers running the app locally.

## Prerequisites

- [Bun](https://bun.sh)
- [wasm-pack](https://rustwasm.github.io/wasm-pack) only to rebuild the Rust/WASM kernel; it is vendored in `src/wasm`, so day-to-day work needs no Rust toolchain.

## Setup

Facet is a client-side app with no secrets or backend, so there is nothing to configure:

```sh
bun install
```

## Run

Development (HTTPS via mkcert):

```sh
bun run dev      # https://localhost:3000
```

Production (static build):

```sh
bun run build    # emits dist/, serve with any static host
bun run preview  # serve the production build locally
```

Docker (multi-stage, builds with Bun, serves with nginx):

```sh
docker build -t facet-app .
docker run -p 8080:8080 facet-app
```

Desktop and mobile (Tauri):

```sh
bun run tauri dev            # desktop
bun run tauri:ios:dev        # iOS (after tauri:ios:init)
bun run tauri:android:dev    # Android (after tauri:android:init)
```

## Diagnostics

- **Serving**: the production image serves the static SPA on `8080`, with nginx falling back to `index.html` for client-side routes. A plain `GET /` returning 200 is a sufficient liveness probe.
- **Engine tests**: `bun test src` runs the kernel and authoring unit tests headlessly (no browser needed).
- **Rebuild the kernel**: `bun run wasm:build` recompiles the Rust kernel into `src/wasm` (needs `wasm-pack`).

## Key commands

| Command | Description |
| --- | --- |
| `bun run dev` | Dev server with HMR (https://localhost:3000) |
| `bun run build` / `bun run preview` | Production build to `dist/` / serve it |
| `bun test src` | Engine unit tests |
| `bunx tsc --noEmit` | TypeScript check |
| `bun run check` | Biome lint and format check |
| `bun run knip` | Unused code and dependency detection |
| `bun run wasm:build` | Recompile the Rust/WASM kernel |
| `bun run tauri` | Tauri CLI (desktop and mobile builds) |

## License

The code in this repository is licensed under Apache 2.0, &copy; [Omni LLC](https://omni.dev). See [LICENSE.md](LICENSE.md) for more information.
