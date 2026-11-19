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

/** The bits of `navigator` the platform check reads */
interface PlatformHints {
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/**
 * Whether this is desktop Linux, where no major browser ships WebGPU on by
 * default yet. Turning it on there (an "unsafe" flag) often hands out a
 * working adapter whose frames never reach the screen, a black canvas the page
 * can not detect, so Auto starts with WebGL instead. Android and ChromeOS also
 * report Linux in the user agent but ship WebGPU, so they keep it.
 *
 * Revisit when WebGPU ships by default on desktop Linux: then Auto should
 * prefer WebGPU everywhere again
 */
export const isDesktopLinux = (nav: PlatformHints): boolean => {
  const platform = nav.userAgentData?.platform;
  if (platform) return platform === "Linux";
  const ua = nav.userAgent ?? "";
  return /Linux/.test(ua) && !/Android|CrOS/.test(ua);
};

/**
 * The renderers to try, in order. Auto prefers WebGPU, except on desktop Linux
 * (see {@link isDesktopLinux}). An explicit WebGPU choice still falls back to
 * WebGL when WebGPU is unavailable, so the preview never goes dark just
 * because a setting outlived the browser support behind it
 */
export const rendererOrder = (
  pref: RendererPreference,
  desktopLinux = false,
): RendererKind[] => {
  if (pref === "webgl") return ["webgl"];
  if (pref === "auto" && desktopLinux) return ["webgl", "webgpu"];
  return ["webgpu", "webgl"];
};

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
