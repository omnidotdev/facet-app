import { registerSW } from "virtual:pwa-register";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import router from "@/router";
import { initTheme } from "@/themeStore";

import "@/styles.css";

// Register the offline-first service worker. autoUpdate swaps in a new build on
// the next navigation. Guard on support so this is a no-op in browsers (or test
// runners) without a service worker, and registerSW itself is a stub when the
// PWA plugin is disabled (e.g. under dev)
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  registerSW({ immediate: true });
}

// Stamp the active theme on <html> before first paint, so every route (and the
// command palette) renders in the correct theme from boot.
initTheme();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
