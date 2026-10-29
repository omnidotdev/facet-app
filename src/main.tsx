import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import router from "@/router";
import { initTheme } from "@/themeStore";

import "@/styles.css";

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
