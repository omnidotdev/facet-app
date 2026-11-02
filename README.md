# Facet

Frontend application for Facet, code-first parametric CAD in the browser: write a model in code, a solid-geometry (CSG) kernel turns it into a mesh, a 3D viewport shows it live, and you export a print-ready STL, 3MF, or STEP file. An optional AI panel turns a plain-English prompt into Facet code when a generation gateway is configured. Built on [TanStack Router](https://tanstack.com/router) and [Tauri](https://v2.tauri.app) (React), with a TypeScript CSG kernel, a Rust kernel compiled to [WebAssembly](https://webassembly.org), and an OpenCascade (OCCT) B-rep kernel loaded via WebAssembly, rendered with [Three.js](https://threejs.org).

Product documentation lives in [Fabric](https://docs.omni.dev/products/facet). This README only covers running the app locally.

## Prerequisites

- [Bun](https://bun.sh)
- [wasm-pack](https://rustwasm.github.io/wasm-pack) only to rebuild the Rust/WASM kernel; it is vendored in `src/wasm`, so day-to-day work needs no Rust toolchain.

## Setup

Facet runs fully client-side with no secrets, so local modeling and export need no configuration:

```sh
bun install
```

AI generation is optional and off by default. To enable the "Describe a part" panel, set two build-time variables (both read by Vite, so they are baked at build):

- `VITE_FACET_API_URL`: the Facet AI gateway base URL. When unset, the panel is hidden and the app stays a pure local CAD tool.
- `VITE_AUTH_BASE_URL`: the Omni identity base URL, used to sign in for managed (metered) generation. Bring-your-own-key generation needs no sign-in.
- `VITE_AUTH_CLIENT_ID`: optional override for Facet's public OAuth client id. The app defaults to the id registered with Gatekeeper (baked into the source like `aspen-editor`, since it is public and stable, not a secret), so production needs nothing. Managed sign-in runs Authorization Code + PKCE in the browser with redirect URI `<origin>/auth/callback`. Set this only to point a non-production build at a different client.
- `VITE_ACCOUNT_URL`: the shared Omni account hub base URL. When set, an out-of-credits user sees an "Upgrade workspace" CTA that links to the hub's Facet billing page. When unset, the CTA is hidden.

Both generation paths run through the [Synapse](https://synapse.omni.dev) AI router:

- **Managed** (signed in): uses Facet's Synapse key and is metered against your monthly Facet credits.
- **Bring your own key** (no account): paste your own [Synapse key](https://synapse.omni.dev) in the panel. Generation is billed to your own Synapse account, bypasses the Facet credit meter, and needs no sign-in. The key is kept only in your browser and sent over TLS to the gateway per request, never stored on Facet's servers.

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

## Releases

Desktop installers are cut by the `Release` GitHub Actions workflow. Pushing a `vX.Y.Z` tag (or running the workflow manually) builds native installers on each OS and opens a draft GitHub release with them attached:

- macOS: `.dmg`
- Windows: `.msi`
- Linux: AppImage and `.deb`

The installers are currently unsigned and the in-app auto-updater is off. Code signing (Apple Developer ID plus notarization, Windows signing certificate) and a signed auto-updater are follow-ups pending the signing certificates and keypair; the workflow leaves commented hooks showing where those secrets plug in.

### Arch Linux (AUR)

On release, the workflow also publishes `facet-bin` to the AUR, a prebuilt package that unpacks the Linux `.deb`. Install it with any AUR helper:

```sh
yay -S facet-bin
```

`facet-bin` is a no-op in CI until a maintainer sets it up once: register the `facet-bin` package on the AUR and add an `AUR_SSH_PRIVATE_KEY` repository secret (the AUR account's SSH key). The checked-in `PKGBUILD` lives in `misc/packaging/aur/facet-bin/`; CI fills in `pkgver` and the `sha256sums` from the release assets.

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
| `bun run opgraph:generate` | Regenerate the op-graph contract from its ODK schema |
| `bun run tauri` | Tauri CLI (desktop and mobile builds) |

## Op-graph contract

The op-graph (the IR that crosses the TypeScript app <-> Rust/WASM kernel boundary) is defined once in [`schema/opgraph.odk.yaml`](schema/opgraph.odk.yaml) and generated by [ODK](https://github.com/omnidotdev/odk) into both targets: the TypeScript union in `src/facet/opgraph.gen.ts` and the Rust serde enum in `crates/facet-kernel/src/opgraph_gen.rs`. Both files are generated, committed, and must not be edited by hand.

Regeneration is the only step that needs ODK; the Facet build consumes the committed generated files and never runs ODK. ODK is not published, so build its CLI from master first:

```bash
git clone https://github.com/omnidotdev/odk && cd odk
cargo build --release -p odk-cli   # or: cargo install --path odk-cli
```

Then regenerate, pointing `ODK` at the binary (or put `odk` on `PATH`):

```bash
ODK=/path/to/odk bun run opgraph:generate
```

## License

The code in this repository is licensed under Apache 2.0, &copy; [Omni LLC](https://omni.dev). See [LICENSE.md](LICENSE.md) for more information.
