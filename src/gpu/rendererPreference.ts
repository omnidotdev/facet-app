import type { RendererKind } from "./backend";

/** Which renderer the viewport should use; "auto" prefers WebGPU and falls back to WebGL */
export type RendererPreference = "auto" | RendererKind;

const KEY = "facet:renderer:v1";

const PREFERENCES: readonly RendererPreference[] = ["auto", "webgpu", "webgl"];

/** A stored value as a preference, defaulting anything unknown to "auto" */
export const parseRendererPreference = (raw: unknown): RendererPreference =>
  PREFERENCES.includes(raw as RendererPreference)
    ? (raw as RendererPreference)
    : "auto";

/**
 * The renderers to try, in order. An explicit WebGPU choice still falls back
 * to WebGL when WebGPU is unavailable, so the preview never goes dark just
 * because a setting outlived the browser support behind it
 */
export const rendererOrder = (pref: RendererPreference): RendererKind[] =>
  pref === "webgl" ? ["webgl"] : ["webgpu", "webgl"];

/** Display name for a renderer */
export const rendererLabel = (kind: RendererKind): string =>
  kind === "webgpu" ? "WebGPU" : "WebGL";

/** The saved preference for this browser, or "auto" when unset or unreadable */
export const loadRendererPreference = (): RendererPreference => {
  try {
    return parseRendererPreference(localStorage.getItem(KEY));
  } catch {
    return "auto";
  }
};

/** Remember the preference for this browser; storage failures are ignored */
export const saveRendererPreference = (pref: RendererPreference): void => {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Private mode or blocked storage: the choice lasts for this session only
  }
};
