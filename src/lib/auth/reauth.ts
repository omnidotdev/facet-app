/**
 * The "sign in again" prompt. Set when Facet drops a session that can no
 * longer use managed generation (a token from before the workspace scope, or
 * the gateway asking for a fresh sign-in), so the user is told why they were
 * signed out instead of the AI panel silently disappearing. Cleared when they
 * start signing in or dismiss it
 */

/** Shown when a session must sign in again; generic and user-safe */
export const REAUTH_MESSAGE = "Sign in again to keep using AI generation.";

export interface ReauthNotice {
  /** The message to show, or null when no prompt is pending */
  current(): string | null;
  /** Raise the prompt */
  flag(): void;
  /** Dismiss the prompt */
  clear(): void;
  /** Subscribe to changes; returns an unsubscribe. For useSyncExternalStore */
  subscribe(listener: () => void): () => void;
}

/** Create a reauth prompt store */
export const createReauthNotice = (): ReauthNotice => {
  let message: string | null = null;
  const listeners = new Set<() => void>();
  const set = (next: string | null) => {
    if (next === message) return;
    message = next;
    for (const listener of listeners) listener();
  };

  return {
    current: () => message,
    flag: () => set(REAUTH_MESSAGE),
    clear: () => set(null),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
