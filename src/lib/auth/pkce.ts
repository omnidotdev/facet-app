/**
 * Pure OAuth 2.0 Authorization Code + PKCE request shaping for the managed
 * AI-generation path.
 *
 * Facet is a static SPA with no server of its own, so it is a public, secretless
 * OAuth client of Omni's Gatekeeper identity service (the aspen-editor pattern).
 * These helpers do no I/O so they are unit-tested directly; the browser plumbing
 * (storage, redirect, token POST) lives in `session.ts`.
 */

/** Scopes the managed path requests. userinfo (which facet-api calls) needs openid. */
export const OAUTH_SCOPE = "openid profile email";

/** Base64url-encode bytes without padding (RFC 4648 url-safe alphabet). */
export const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

/** A cryptographically-random base64url string from `byteLength` random bytes. */
export const randomBase64Url = (byteLength: number): string => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
};

/** The PKCE S256 code challenge for a verifier: base64url(sha256(verifier)). */
export const codeChallengeS256 = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(new Uint8Array(digest));
};

interface AuthorizeUrlInput {
  authBaseUrl: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
}

/** Build the Gatekeeper authorize-redirect URL for a login attempt. */
export const buildAuthorizeUrl = ({
  authBaseUrl,
  clientId,
  redirectUri,
  scope,
  state,
  codeChallenge,
}: AuthorizeUrlInput): string => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${authBaseUrl.replace(/\/+$/, "")}/oauth2/authorize?${params.toString()}`;
};

/** The result of parsing an OAuth redirect callback query string. */
export type CallbackParams =
  | { ok: true; code: string; state: string }
  | { ok: false; error: string };

/**
 * Parse `code`+`state` (or an `error`) from a redirect callback query string.
 * Accepts a leading `?`. A missing code or state is reported as an error so the
 * caller never proceeds with a partial callback.
 */
export const parseCallbackParams = (search: string): CallbackParams => {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const error = params.get("error");
  if (error) return { ok: false, error };

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return { ok: false, error: "missing_code_or_state" };

  return { ok: true, code, state };
};

interface TokenRequestInput {
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}

/** Build the form-urlencoded body for the token exchange (public client, no secret). */
export const buildTokenRequestBody = ({
  clientId,
  redirectUri,
  code,
  codeVerifier,
}: TokenRequestInput): string =>
  new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  }).toString();

/** A parsed token-endpoint response, or null when it carries no access token. */
export interface ParsedTokenResponse {
  accessToken: string;
  /** Lifetime in seconds, when the endpoint reports it. */
  expiresIn: number | null;
}

/** Pull the access token (and optional lifetime) out of a token-endpoint JSON body. */
export const parseTokenResponse = (
  body: unknown,
): ParsedTokenResponse | null => {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const accessToken = record.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) return null;

  const expiresIn = record.expires_in;
  return {
    accessToken,
    expiresIn: typeof expiresIn === "number" ? expiresIn : null,
  };
};
