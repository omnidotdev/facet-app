/**
 * Persistence for the working model and Studio preferences.
 *
 * Today this is a single local (per-browser) project in localStorage, keyed and
 * versioned. It is deliberately a small seam: the same `loadProject` /
 * `saveProject` shape can later be backed by an Omni account (Gatekeeper auth +
 * project storage on Arbor, gated by Aether tiers) without changing callers.
 *
 * Every storage access is guarded so the Studio works when storage is
 * unavailable (private windows, blocked site data, quota).
 */

const KEY = "facet:project:v1";

interface SavedProject {
  /** The model source in the editor. */
  code: string;
  /** Selected geometry kernel ("ts" | "rust"). */
  kernel: string;
  /** Selected export format ("stl" | "3mf"). */
  format: string;
}

/** Load the saved project, or null if none/unavailable/corrupt. */
export function loadProject(): SavedProject | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SavedProject>;
    if (typeof p?.code !== "string") return null;
    return {
      code: p.code,
      kernel: typeof p.kernel === "string" ? p.kernel : "ts",
      format: typeof p.format === "string" ? p.format : "stl",
    };
  } catch {
    return null;
  }
}

/** Persist the working project. Silently no-ops if storage is unavailable. */
export function saveProject(project: SavedProject): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(project));
  } catch {
    // storage unavailable or over quota - degrade without breaking the Studio
  }
}
