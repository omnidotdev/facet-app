import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

// Tauri sets this when developing the native app against a device on the LAN.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ command }) => ({
  plugins: [
    devtools(),
    // Serve dev over https with a locally-trusted cert, matching other Omni apps.
    command === "serve" && mkcert(),
    TanStackRouterVite(),
    tailwindcss(),
    react(),
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
