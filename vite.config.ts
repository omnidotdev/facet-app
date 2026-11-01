import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import typegpu from "unplugin-typegpu/vite";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";
import { VitePWA } from "vite-plugin-pwa";

// Tauri sets this when developing the native app against a device on the LAN.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ command }) => ({
  plugins: [
    devtools(),
    // Serve dev over https with a locally-trusted cert, matching other Omni apps.
    command === "serve" && mkcert(),
    TanStackRouterVite(),
    tailwindcss(),
    // Transpiles TGSL 'use gpu' shader functions to WGSL at build time
    typegpu(),
    react(),
    // Offline-first PWA. After the first load the app shell, the vendored
    // Rust/WASM mesh kernel, and the replicad glue are precached, so local
    // modeling and STL/3MF/STEP export run with no network. The large OCCT
    // B-rep wasm is runtime-cached on first use instead of bloating the
    // precache, and the AI gateway and identity endpoints are never cached
    VitePWA({
      // Disable the service worker in Tauri (desktop) builds. The native app is
      // already offline, and a service worker under Tauri's custom app:// scheme
      // breaks the WebKitGTK webview (blank screen). TAURI_ENV_PLATFORM is set
      // by the Tauri CLI while it runs the frontend build
      disable: Boolean(process.env.TAURI_ENV_PLATFORM),
      // Seamless updates: a new build is swapped in on the next navigation
      // without leaving a stale shell behind
      registerType: "autoUpdate",
      // The SW is registered by hand from src/main.tsx via the virtual
      // registerSW module, so skip the auto-injected registration script
      injectRegister: false,
      // Single source of truth for the web app manifest. This replaces the
      // former public/manifest.webmanifest; the plugin emits the file and
      // injects its <link> into index.html
      manifest: {
        name: "Facet",
        short_name: "Facet",
        description: "Code-first parametric CAD in the browser.",
        start_url: "/",
        display: "standalone",
        background_color: "#0b1c2e",
        theme_color: "#0b1c2e",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
        ],
      },
      workbox: {
        // Precache the shell plus the small vendored mesh-kernel wasm. The glob
        // adds `wasm` on top of the defaults; the OCCT blob is excluded below
        // and runtime-cached instead
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,wasm}"],
        // Keep the ~23 MB OCCT B-rep wasm out of the precache entirely (it is
        // runtime-cached on demand). Excluding it by glob avoids the oversized
        // asset warning that the size limit alone would raise
        globIgnores: ["**/replicad_single-*.wasm"],
        // Headroom to precache the ~160 KB mesh kernel and the ~1.4 MB app
        // bundle as it grows
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // SPA: serve the app shell for navigations with no network, so deep
        // links resolve offline
        navigateFallback: "/index.html",
        // Keep data endpoints off the navigation fallback
        navigateFallbackDenylist: [/\/generate$/, /\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // The on-demand OCCT B-rep wasm (~23 MB, same-origin hashed asset
            // emitted by Vite). CacheFirst so B-rep modeling and STEP export
            // work offline after the first use, without bloating the precache
            urlPattern: /replicad_single-[^/]*\.wasm$/,
            handler: "CacheFirst",
            options: {
              cacheName: "facet-occt-wasm",
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // AI generation gateway (VITE_FACET_API_URL + /generate). Never
            // cache: AI output must always come from the live network
            urlPattern: /\/generate$/,
            handler: "NetworkOnly",
          },
          {
            // Auth/identity endpoints (Omni Gatekeeper). Never cache
            urlPattern: /\/api\/auth\//,
            handler: "NetworkOnly",
          },
        ],
      },
      // Leave the SW disabled under `vite` dev so the dev server is unaffected
      devOptions: {
        enabled: false,
      },
    }),
  ],
  clearScreen: false,
  server: {
    port: 3000,
    strictPort: true,
    host: host || "0.0.0.0",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 3001,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
}));
