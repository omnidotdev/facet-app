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

import { createTabsState } from "./tabs";

import type { Tab, TabsState } from "./tabs";

const KEY = "facet:project:v1";
const WORKSPACE_KEY = "facet:workspace:v1";

interface SavedProject {
  /** The model source in the editor. */
  code: string;
  /** Selected geometry kernel ("ts" | "rust"). */
  kernel: string;
  /** Selected export format ("stl" | "3mf"). */
  format: string;
}

/**
 * The whole Studio workspace: the open models (tabs) plus the global geometry
 * kernel and export-format preferences (which are chosen once, not per model).
 */
export interface SavedWorkspace extends TabsState {
  kernel: string;
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

/** Validate a parsed value as a tabs array, or return null. */
function parseTabs(value: unknown): Tab[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const tabs: Tab[] = [];
  for (const raw of value) {
    const t = raw as Partial<Tab>;
    if (
      typeof t?.id !== "string" ||
      typeof t?.name !== "string" ||
      typeof t?.code !== "string"
    ) {
      return null;
    }
    tabs.push({ id: t.id, name: t.name, code: t.code });
  }
  return tabs;
}

/**
 * Load the saved workspace, migrating a legacy single project into one tab on
 * first run. Returns null only when nothing is saved (or storage is
 * unavailable), so the caller seeds a default. Corrupt workspace data falls
 * back to the legacy project, then to null, never throwing.
 */
export function loadWorkspace(): SavedWorkspace | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SavedWorkspace>;
      const tabs = parseTabs(parsed?.tabs);
      if (tabs) {
        // Keep the active pointer valid even if the stored id went missing
        const activeId =
          typeof parsed.activeId === "string" &&
          tabs.some((t) => t.id === parsed.activeId)
            ? parsed.activeId
            : tabs[0]!.id;
        return {
          tabs,
          activeId,
          kernel: typeof parsed.kernel === "string" ? parsed.kernel : "ts",
          format: typeof parsed.format === "string" ? parsed.format : "stl",
        };
      }
    }
  } catch {
    // fall through to the legacy-project migration
  }

  // Migrate the legacy single project (facet:project:v1) into one tab
  const legacy = loadProject();
  if (legacy) {
    return {
      ...createTabsState(legacy.code),
      kernel: legacy.kernel,
      format: legacy.format,
    };
  }
  return null;
}

/** Persist the workspace. Silently no-ops if storage is unavailable. */
export function saveWorkspace(workspace: SavedWorkspace): void {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  } catch {
    // storage unavailable or over quota - degrade without breaking the Studio
  }
}
