/**
 * Pure state model for the Studio's open models ("tabs").
 *
 * The Studio holds several independent models at once, each its own editor
 * document, so a new generation (or example) no longer wipes the current work.
 * A tab is just a named source document; parameters are re-derived from the
 * code and the geometry kernel is chosen globally, so a tab carries no other
 * per-model state. This stays a small, dependency-free seam (no DOM, no
 * storage) so it is fully unit-testable and can later back onto account-synced
 * project storage without changing callers.
 *
 * Multi-file models that import one another are deliberately out of scope here:
 * that needs the planned sandboxed-worker + esbuild evaluation path first, and
 * would layer on top of this document model rather than replace it.
 */

export interface Tab {
  /** Stable id, used as the React key and the active-tab pointer. */
  id: string;
  /** Display name shown on the tab (from a prompt, an example, or auto). */
  name: string;
  /** The model source for this tab. */
  code: string;
}

export interface TabsState {
  tabs: Tab[];
  /** Id of the active tab; always references a tab in `tabs`. */
  activeId: string;
}

/** Default name for an untitled model, numbered to stay unique. */
const AUTO_NAME_PREFIX = "Model";

/** A new, unique-enough id. Falls back when crypto.randomUUID is unavailable. */
const makeTabId = (): string => {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    // fall through to the non-crypto fallback
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

/** The active tab, or undefined if the state is somehow empty. */
export const activeTab = (state: TabsState): Tab | undefined =>
  state.tabs.find((t) => t.id === state.activeId);

/**
 * The next free auto name ("Model 1", "Model 2", ...), one past the highest
 * numbered auto name already in use, so a fresh tab never collides.
 */
export const nextAutoName = (state: TabsState): string => {
  const pattern = new RegExp(`^${AUTO_NAME_PREFIX} (\\d+)$`);
  let max = 0;
  for (const tab of state.tabs) {
    const match = tab.name.match(pattern);
    const n = match ? Number.parseInt(match[1] ?? "", 10) : 0;
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${AUTO_NAME_PREFIX} ${max + 1}`;
};

/** A one-tab state seeded from initial code (used for a first run or migration). */
export const createTabsState = (
  code: string,
  name = `${AUTO_NAME_PREFIX} 1`,
): TabsState => {
  const id = makeTabId();
  return { tabs: [{ id, name, code }], activeId: id };
};

/**
 * Add a new tab after the active one and make it active. Returns the new state
 * and the new tab's id (so the caller can load it into the editor). An unnamed
 * tab gets the next auto name.
 */
export const addTab = (
  state: TabsState,
  code = "",
  name?: string,
): { state: TabsState; id: string } => {
  const id = makeTabId();
  const tab: Tab = { id, name: name ?? nextAutoName(state), code };
  const at = state.tabs.findIndex((t) => t.id === state.activeId);
  const tabs = [...state.tabs];
  // Insert just after the active tab, or at the end when none is active
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
  return { state: { tabs, activeId: id }, id };
};

/** Point the active pointer at `id` (no-op if `id` is not an open tab). */
export const setActive = (state: TabsState, id: string): TabsState =>
  state.tabs.some((t) => t.id === id) ? { ...state, activeId: id } : state;

/** Replace the active tab's code. */
export const setActiveCode = (state: TabsState, code: string): TabsState => ({
  ...state,
  tabs: state.tabs.map((t) => (t.id === state.activeId ? { ...t, code } : t)),
});

/** Rename a tab; an empty or whitespace-only name is ignored. */
export const renameTab = (
  state: TabsState,
  id: string,
  name: string,
): TabsState => {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
  };
};

/**
 * Close a tab. When the closed tab was active, the neighbour to its left (else
 * to its right) becomes active. Closing the last remaining tab leaves a single
 * fresh blank tab, so there is always at least one open model.
 */
export const closeTab = (state: TabsState, id: string): TabsState => {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index < 0) return state;

  if (state.tabs.length === 1) return createTabsState("");

  const tabs = state.tabs.filter((t) => t.id !== id);
  let activeId = state.activeId;
  if (state.activeId === id) {
    // Prefer the tab that shifted into this slot's left neighbour
    const neighbour = tabs[Math.max(0, index - 1)];
    activeId = neighbour?.id ?? tabs[0]!.id;
  }
  return { tabs, activeId };
};

/** Truncate a prompt into a short, trimmed tab name. */
export const nameFromPrompt = (prompt: string, max = 24): string => {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
};
