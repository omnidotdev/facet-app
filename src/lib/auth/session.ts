import { createManagedAiAuth } from "@omnidotdev/providers/ai-client";

import type {
  KeyValueStore,
  NativeAuthAdapter,
} from "@omnidotdev/providers/ai-client";

/**
 * Managed AI-generation sign-in for the Facet SPA.
 *
 * Facet has no server for the AI path, so it authenticates to Omni's Gatekeeper
 * as a public, secretless OAuth client via in-browser Authorization Code + PKCE,
 * stores the access token, and sends it as a bearer to facet-api. The PKCE flow,
 * session storage, and token exchange are the fleet-shared implementation in
 * `@omnidotdev/providers/ai-client`; this module only wires Facet's config
 * (Gatekeeper URL + client id, redirect, the desktop loopback) to it and keeps
 * the same export surface the rest of the app already imports. Only the managed
 * path needs this; BYOK and all local modeling stay anonymous and never touch it.
 */

const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL;
// Facet's public OAuth client id, registered with Gatekeeper as a secretless
// SPA/PKCE client. Public and stable (not a secret), baked into the source like
// aspen-editor's; an env override is honored for non-prod deployments
const CLIENT_ID =
  import.meta.env.VITE_AUTH_CLIENT_ID ?? "e5ae6c967aa2049e1fd7f905a7786244";

// Desktop (Tauri) cannot receive a browser redirect under the tauri:// origin,
// so native login uses a fixed loopback the Rust side listens on (RFC 8252)
const NATIVE_REDIRECT_URI = "http://127.0.0.1:8973/callback";

// localStorage holds the access token across reloads; sessionStorage holds the
// in-flight PKCE verifier/state only until the callback consumes them. Keep the
// existing keys so tokens issued before this refactor stay valid
const TOKEN_KEY = "facet:auth-token:v1";
const FLOW_KEY = "facet:auth-flow:v1";

/** A no-op store so module load never throws off the browser (SSR/tests). */
const NOOP_STORE: KeyValueStore = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const hasWindow = typeof window !== "undefined";
const tokenStore: KeyValueStore =
  typeof localStorage !== "undefined" ? localStorage : NOOP_STORE;
const flowStore: KeyValueStore =
  typeof sessionStorage !== "undefined" ? sessionStorage : NOOP_STORE;

const inTauri = (): boolean => hasWindow && "__TAURI_INTERNALS__" in window;

// Native (desktop) login: open the system browser and catch the redirect on a
// loopback port via the Rust `oauth_loopback` command. The verifier never
// leaves JS; the shared session exchanges in place
const native: NativeAuthAdapter = {
  isNative: inTauri,
  redirectUri: NATIVE_REDIRECT_URI,
  invokeLoopback: async (authorizeUrl) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("oauth_loopback", { authorizeUrl });
  },
};

const auth = createManagedAiAuth({
  authBaseUrl: AUTH_BASE_URL,
  clientId: CLIENT_ID,
  // The redirect URI must match the Gatekeeper client registration EXACTLY, so
  // it is derived from the live origin plus a fixed path (registered per deploy)
  resolveRedirectUri: () => `${window.location.origin}/auth/callback`,
  resolveReturnTo: () => window.location.href,
  navigate: (url) => window.location.assign(url),
  tokenStore,
  flowStore,
  tokenKey: TOKEN_KEY,
  flowKey: FLOW_KEY,
  // Force the Gatekeeper login screen so the user can pick/switch accounts
  // (Gatekeeper rejects prompt=select_account; "login" is the supported way)
  prompt: "login",
  native,
});

/** Whether Omni sign-in is configured for this deployment (base URL + client id). */
export const isAuthConfigured = auth.isConfigured;
/** Whether a valid (unexpired) access token is present. */
export const isSignedIn = auth.isSignedIn;
/** Start the PKCE login (web redirect, or the desktop loopback under Tauri). */
export const signIn = auth.signIn;
/** Complete the OAuth redirect on the callback route. */
export const completeCallback = auth.completeCallback;
/** Forget the stored token. */
export const signOut = auth.signOut;
/** The current Omni access token for a managed call, or null when signed out/expired. */
export const getAccessToken = auth.getAccessToken;

/**
 * Subscribe to auth-state changes; returns an unsubscribe. For
 * useSyncExternalStore. Re-renders on sign-in/out in this tab (via the shared
 * session) and across tabs (via the storage event, so a sign-out in one tab
 * propagates to the others)
 */
export const subscribeAuth = (listener: () => void): (() => void) => {
  const unsubscribe = auth.subscribe(listener);
  if (!hasWindow) return unsubscribe;

  const onStorage = (event: StorageEvent) => {
    if (event.key === TOKEN_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", onStorage);
  };
};
