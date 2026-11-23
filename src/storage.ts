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

const PARAMS_COLLAPSED_KEY = "facet:params-collapsed:v1";

/**
 * Whether the parameters panel is collapsed. A per-browser view preference,
 * like the theme, so it survives reloads and model switches
 */
export function loadParamsCollapsed(): boolean {
  try {
    return localStorage.getItem(PARAMS_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the parameters panel state. Silently no-ops without storage */
export function saveParamsCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(PARAMS_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // storage unavailable - the panel still toggles, it just won't persist
  }
}

const INVERT_DRAG_KEY = "facet:invert-drag:v1";

/**
 * Whether dragging the view orbits the opposite way. A per-browser input
 * preference, since which way feels natural depends on the modeler a person
 * learned on
 */
export function loadInvertDrag(): boolean {
  try {
    return localStorage.getItem(INVERT_DRAG_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the orbit drag direction. Silently no-ops without storage */
export function saveInvertDrag(inverted: boolean): void {
  try {
    localStorage.setItem(INVERT_DRAG_KEY, inverted ? "1" : "0");
  } catch {
    // storage unavailable - the setting applies for this session only
  }
}

const EDITOR_WIDTH_KEY = "facet:editor-width:v1";

/** The editor's share of the Studio width when nothing is saved */
export const DEFAULT_EDITOR_FRACTION = 0.4;
/** The narrowest the code editor gets, in CSS pixels */
export const MIN_EDITOR_PX = 280;
/** The narrowest the 3D view gets, in CSS pixels */
export const MIN_VIEWPORT_PX = 320;

/**
 * Clamp the editor's share of a Studio `total` pixels wide so both panes keep
 * a usable minimum. When the window is too narrow for both minimums, the
 * editor keeps its minimum and the view takes the rest
 */
export function clampEditorFraction(fraction: number, total: number): number {
  if (!Number.isFinite(fraction) || total <= 0) return DEFAULT_EDITOR_FRACTION;
  const min = MIN_EDITOR_PX / total;
  const max = 1 - MIN_VIEWPORT_PX / total;
  if (max <= min) return Math.min(min, 1);
  return Math.min(Math.max(fraction, min), max);
}

/** The saved editor share of the Studio width, or null to use the default */
export function loadEditorFraction(): number | null {
  try {
    const raw = localStorage.getItem(EDITOR_WIDTH_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 && value < 1 ? value : null;
  } catch {
    return null;
  }
}

/** Persist the editor share, or forget it (back to the default) with null */
export function saveEditorFraction(fraction: number | null): void {
  try {
    if (fraction === null) localStorage.removeItem(EDITOR_WIDTH_KEY);
    else localStorage.setItem(EDITOR_WIDTH_KEY, fraction.toFixed(4));
  } catch {
    // storage unavailable - the split still moves, it just won't persist
  }
}
