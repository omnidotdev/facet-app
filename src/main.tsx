import { registerSW } from "virtual:pwa-register";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import router from "@/router";
import { initTheme } from "@/themeStore";

import "@/styles.css";

// Register the offline-first service worker on the web only. autoUpdate swaps in
// a new build on the next navigation. The native Tauri app is already offline,
// and a service worker breaks the WebKitGTK webview (blank screen), so under
// Tauri skip registration and tear down any worker a prior build left behind.
// Guard on support so this is a no-op where a service worker is unavailable
const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  if (inTauri) {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) registration.unregister();
      })
      .catch(() => {});
  } else {
    registerSW({ immediate: true });
  }
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
