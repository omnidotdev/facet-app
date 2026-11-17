/**
 * OAuth scope handling for Facet's managed sign-in.
 *
 * facet-api bills the user's personal workspace, which it reads from the
 * Gatekeeper userinfo `organizations` claim. Gatekeeper only includes that
 * claim for a token granted the `organization` scope, so Facet asks for it at
 * sign-in and treats a stored session without it as signed out (the user signs
 * in again and gets a token that carries the claim).
 *
 * The shared session (`createManagedAiAuth`) stores only the access token and
 * its expiry, so the granted scope is recorded here: a fetch wrapper reads the
 * `scope` field of the token response, and a store wrapper adds it to the
 * stored token and rejects a stored token without the required scope (including
 * every session stored before the scope was recorded)
 */

import type { KeyValueStore } from "@omnidotdev/providers/ai-client";

/** The scope required for workspace billing */
export const REQUIRED_SCOPE = "organization";

/** The scope Facet requests at sign-in */
export const AUTH_SCOPE = `openid profile email ${REQUIRED_SCOPE}`;

/** Whether a space-separated scope string grants `required` */
export const hasScope = (
  scope: string | undefined,
  required: string,
): boolean => (scope ?? "").split(/\s+/).includes(required);

/**
 * The scope a token response granted. An omitted `scope` means the requested
 * scope was granted in full (RFC 6749 section 5.1)
 * @param body - The parsed token response
 * @param requestedScope - The scope sent on the authorize request
 */
export const grantedScope = (body: unknown, requestedScope: string): string => {
  const scope =
    body && typeof body === "object"
      ? (body as { scope?: unknown }).scope
      : undefined;
  return typeof scope === "string" && scope.trim() ? scope : requestedScope;
};

interface ScopedTokenStoreConfig {
  /** The underlying persistent store (localStorage) */
  store: KeyValueStore;
  /** The key the session stores its token under */
  tokenKey: string;
  /** The scope requested at sign-in */
  requestedScope: string;
  /** The scope a stored token must carry; defaults to `REQUIRED_SCOPE` */
  requiredScope?: string;
  /** The fetch the session's token exchange uses; defaults to the global */
  fetchImpl?: typeof fetch;
  /**
   * Called (once per dropped token, deferred off the read path) when a stored
   * session lacks the required scope, so the UI can ask the user to sign in again
   */
  onStale?: () => void;
}

/** A stored session token, with the scope this module records alongside it */
interface StoredToken {
  accessToken?: unknown;
  scope?: unknown;
}

const parseStored = (raw: string): StoredToken | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as StoredToken)
      : null;
  } catch {
    return null;
  }
};

const requestUrl = (input: RequestInfo | URL): string =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

/**
 * Wrap the session's token store and fetch so the granted scope is recorded
 * with the token and a token without the required scope is never used
 */
export const createScopedTokenStore = ({
  store,
  tokenKey,
  requestedScope,
  requiredScope = REQUIRED_SCOPE,
  fetchImpl,
  onStale,
}: ScopedTokenStoreConfig): {
  store: KeyValueStore;
  fetchImpl: typeof fetch;
} => {
  // The scope of the most recent token exchange, consumed by the next write
  let pendingScope: string | null = null;

  const scopedFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const doFetch = fetchImpl ?? globalThis.fetch;
    const response = await doFetch(input, init);
    if (response.ok && requestUrl(input).endsWith("/oauth2/token")) {
      let body: unknown = null;
      try {
        body = await response.clone().json();
      } catch {
        // The session rejects an unreadable body itself; record the request
      }
      pendingScope = grantedScope(body, requestedScope);
    }
    return response;
  }) as typeof fetch;

  const scopedStore: KeyValueStore = {
    getItem(key) {
      const raw = store.getItem(key);
      if (key !== tokenKey || raw === null) return raw;

      const token = parseStored(raw);
      if (!token) return null;
      if (
        typeof token.scope === "string" &&
        hasScope(token.scope, requiredScope)
      ) {
        return raw;
      }

      // A legacy session (no recorded scope) or a token granted without the
      // required scope: forget it so the user signs in again
      store.removeItem(key);
      if (onStale) queueMicrotask(onStale);
      return null;
    },

    setItem(key, value) {
      if (key !== tokenKey) {
        store.setItem(key, value);
        return;
      }
      const token = parseStored(value);
      const scope = pendingScope ?? requestedScope;
      pendingScope = null;
      store.setItem(key, token ? JSON.stringify({ ...token, scope }) : value);
    },

    removeItem(key) {
      store.removeItem(key);
    },
  };

  return { store: scopedStore, fetchImpl: scopedFetch };
};
