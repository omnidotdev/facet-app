import type { RenderMode } from "@/gpu/renderMode";
import type { ViewName } from "@/gpu/views";

/**
 * The camera actions the Studio viewport offers to the rest of the app. The
 * command palette lives at the app root, outside the Studio, so the Studio
 * registers its viewport here while it is mounted and the palette lists the
 * view commands only then
 */
export interface ViewControl {
  setView: (view: ViewName) => void;
  flipView: () => void;
  frameModel: () => void;
  toggleProjection: () => void;
  setRenderMode: (mode: RenderMode) => void;
}

let control: ViewControl | null = null;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

/** Make the viewport's actions available; returns the matching unregister */
export const registerViewControl = (next: ViewControl): (() => void) => {
  control = next;
  emit();
  return () => {
    if (control !== next) return;
    control = null;
    emit();
  };
};

/** The registered actions, or null when no viewport is mounted */
export const getViewControl = (): ViewControl | null => control;

/** Subscribe to registration changes, for useSyncExternalStore */
export const subscribeViewControl = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
