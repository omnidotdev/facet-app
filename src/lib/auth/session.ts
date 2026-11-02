import {
  OAUTH_SCOPE,
  buildAuthorizeUrl,
  buildTokenRequestBody,
  codeChallengeS256,
  parseCallbackParams,
  parseTokenResponse,
  randomBase64Url,
} from "@/lib/auth/pkce";

/**
 * Managed AI-generation sign-in for the static SPA.
 *
 * Facet has no server, so it authenticates to Omni's Gatekeeper as a public,
 * secretless OAuth client via in-browser Authorization Code + PKCE (the
 * aspen-editor pattern), stores the resulting access token, and sends it as a
 * bearer to facet-api, which resolves it against Gatekeeper's userinfo exactly
 * like the rest of the fleet. Only the managed path needs this; BYOK and all
 * local modeling stay fully anonymous and never touch anything here.
 */

const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL;
// Facet's public OAuth client id, registered with Gatekeeper as a secretless
// SPA/PKCE client. It is public and stable (not a secret), so it is baked into
// the source like aspen-editor's client id rather than injected per build; an
// env override is honored for non-prod deployments
const CLIENT_ID =
  import.meta.env.VITE_AUTH_CLIENT_ID ?? "e5ae6c967aa2049e1fd7f905a7786244";

// The redirect URI must match the Gatekeeper client registration EXACTLY, so it
// is derived from the live origin plus a fixed path (registered per deployment)
const redirectUri = (): string => `${window.location.origin}/auth/callback`;

// localStorage holds the access token across reloads; sessionStorage holds the
// in-flight PKCE verifier/state only until the callback consumes them. A static
// SPA has no server to hold an httpOnly cookie, so this mirrors aspen-editor
const TOKEN_KEY = "facet:auth-token:v1";
const FLOW_KEY = "facet:auth-flow:v1";
// Treat a token as expired this many ms early, so an in-flight request does not
// race the real expiry
const EXPIRY_SKEW_MS = 5_000;

interface StoredToken {
  accessToken: string;
  /** Epoch ms, or null when the endpoint reported no lifetime. */
  expiresAt: number | null;
}

interface FlowState {
  verifier: string;
  state: string;
  /** Where to send the user back after a successful exchange. */
  returnTo: string;
}

/** Read + parse a JSON value from a storage, tolerating private mode or bad data. */
const readJson = <T>(storage: Storage, key: string): T | null => {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const writeJson = (storage: Storage, key: string, value: unknown): void => {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage disabled; the flow still works in-memory for this
    // navigation on platforms that allow it, and simply cannot persist here
  }
};

const remove = (storage: Storage, key: string): void => {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do if storage is unavailable
  }
};

// In-tab listeners for the auth state, so React re-renders on sign-in/out
// without a reload. Cross-tab changes arrive via the storage event below
const listeners = new Set<() => void>();
const notify = (): void => {
  for (const listener of listeners) listener();
};

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === TOKEN_KEY) notify();
  });
}

const readToken = (): StoredToken | null => {
  const token = readJson<StoredToken>(localStorage, TOKEN_KEY);
  if (!token?.accessToken) return null;
  if (
    token.expiresAt !== null &&
    Date.now() >= token.expiresAt - EXPIRY_SKEW_MS
  ) {
    remove(localStorage, TOKEN_KEY);
    return null;
  }
  return token;
};

/** Whether Omni sign-in is configured for this deployment (base URL + client id). */
export const isAuthConfigured = (): boolean => Boolean(AUTH_BASE_URL);

/** Whether a valid (unexpired) access token is present. */
export const isSignedIn = (): boolean => readToken() !== null;

/** Subscribe to auth-state changes; returns an unsubscribe. For useSyncExternalStore. */
export const subscribeAuth = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Start the PKCE login: stash a fresh verifier/state, then redirect the page to
 * Gatekeeper's authorize endpoint. Returns to the current page after callback.
 */
export const signIn = async (): Promise<void> => {
  if (!isAuthConfigured()) return;

  const verifier = randomBase64Url(32);
  const state = randomBase64Url(16);
  const codeChallenge = await codeChallengeS256(verifier);

  const flow: FlowState = { verifier, state, returnTo: window.location.href };
  writeJson(sessionStorage, FLOW_KEY, flow);

  window.location.assign(
    buildAuthorizeUrl({
      // isAuthConfigured guarantees these are set
      authBaseUrl: AUTH_BASE_URL as string,
      clientId: CLIENT_ID,
      redirectUri: redirectUri(),
      scope: OAUTH_SCOPE,
      state,
      codeChallenge,
    }),
  );
};

/** The outcome of completing the OAuth redirect. */
export type CallbackResult =
  | { ok: true; returnTo: string }
  | { ok: false; error: string };

/**
 * Complete the OAuth redirect on the callback route: validate state, exchange
 * the code for an access token (public client, PKCE verifier, no secret), store
 * it, and report where to send the user back. Never surfaces provider detail.
 */
export const completeCallback = async (
  search: string,
): Promise<CallbackResult> => {
  if (!isAuthConfigured()) return { ok: false, error: "not_configured" };

  const params = parseCallbackParams(search);
  if (!params.ok) return { ok: false, error: params.error };

  const flow = readJson<FlowState>(sessionStorage, FLOW_KEY);
  remove(sessionStorage, FLOW_KEY);
  if (!flow || flow.state !== params.state) {
    return { ok: false, error: "state_mismatch" };
  }

  let parsed: ReturnType<typeof parseTokenResponse>;
  try {
    const response = await fetch(
      `${(AUTH_BASE_URL as string).replace(/\/+$/, "")}/oauth2/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: buildTokenRequestBody({
          clientId: CLIENT_ID,
          redirectUri: redirectUri(),
          code: params.code,
          codeVerifier: flow.verifier,
        }),
      },
    );
    if (!response.ok) return { ok: false, error: "token_exchange_failed" };
    parsed = parseTokenResponse(await response.json());
  } catch {
    return { ok: false, error: "token_exchange_failed" };
  }

  if (!parsed) return { ok: false, error: "token_exchange_failed" };

  const stored: StoredToken = {
    accessToken: parsed.accessToken,
    expiresAt:
      parsed.expiresIn !== null ? Date.now() + parsed.expiresIn * 1_000 : null,
  };
  writeJson(localStorage, TOKEN_KEY, stored);
  notify();

  return { ok: true, returnTo: flow.returnTo || "/" };
};

/** Forget the stored token. */
export const signOut = async (): Promise<void> => {
  remove(localStorage, TOKEN_KEY);
  notify();
};

/**
 * The current Omni access token for a managed gateway call, or null when signed
 * out or expired. facet-api resolves this bearer against Gatekeeper's userinfo.
 * Async to preserve the caller contract (and leave room for a future refresh).
 */
export const getAccessToken = async (): Promise<string | null> =>
  readToken()?.accessToken ?? null;
