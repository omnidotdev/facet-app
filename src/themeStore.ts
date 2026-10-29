/**
 * Single source of truth for the active theme.
 *
 * The Studio owns a viewport and a code editor that must be re-themed
 * imperatively, while the shared command palette (and the global `t` hotkey it
 * binds) can toggle the theme from outside the Studio. This store reconciles
 * the two: `setTheme`/`toggleTheme` stamp the DOM via `applyTheme` and notify
 * subscribers, so the Studio stays in sync no matter who flips the theme.
 */

import { applyTheme, getInitialTheme } from "@/theme";

import type { Theme } from "@/theme";

let current: Theme = getInitialTheme();

const listeners = new Set<(theme: Theme) => void>();

/** The active theme. */
export function getTheme(): Theme {
  return current;
}

/** Set the theme, stamp it on the document, and notify subscribers. */
export function setTheme(theme: Theme): void {
  current = theme;
  applyTheme(theme);
  for (const listener of listeners) listener(theme);
}

/** Flip between light and dark. */
export function toggleTheme(): void {
  setTheme(current === "dark" ? "light" : "dark");
}

/**
 * Subscribe to theme changes. Returns an unsubscribe function. The listener is
 * not called on subscribe, only on subsequent changes.
 */
export function subscribe(listener: (theme: Theme) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stamp the initial theme on the document. Call once at app boot. */
export function initTheme(): void {
  applyTheme(current);
}
