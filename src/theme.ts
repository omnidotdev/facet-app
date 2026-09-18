export type Theme = "light" | "dark";

const STORAGE_KEY = "facet-theme";

/** Saved choice, else the OS preference, else dark. All storage access guarded. */
export function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // storage blocked (private window, etc.) - fall through
  }
  try {
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch {
    // matchMedia unavailable - fall through
  }
  return "dark";
}

/** Stamp the theme on <html> (drives CSS tokens) and remember it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}
