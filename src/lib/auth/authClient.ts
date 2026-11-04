import { createAuthClient } from "better-auth/react";

/**
 * Auth browser client.
 *
 * Facet is a static SPA with no server of its own, so (unlike the full-stack
 * fleet apps that run their own Better Auth server and proxy OAuth) this client
 * points straight at the Omni Gatekeeper via `VITE_AUTH_BASE_URL`. Sign-in is
 * driven through `signIn.social` on the base client, matching aspen-app and
 * arbor-app; better-auth 1.7 routes generic OAuth through the social path, so
 * no extra client plugin is needed.
 *
 * When `VITE_AUTH_BASE_URL` is unset the client would fall back to the page
 * origin. On the web that origin is `https://...`, so a session read just
 * resolves to signed-out and only the BYOK path works, keeping local modeling
 * and BYOK fully anonymous. Under Tauri the origin is `tauri://localhost`, which
 * Better Auth rejects as an invalid base URL by THROWING during import, which
 * blanks the whole app. So when no base URL is configured and the page origin is
 * not http(s), fall back to the production Gatekeeper instead of the origin, so
 * the client always receives a valid base.
 */
const configuredBaseUrl = import.meta.env.VITE_AUTH_BASE_URL;
const pageOriginIsHttp =
  typeof window !== "undefined" &&
  (window.location.protocol === "http:" ||
    window.location.protocol === "https:");
const baseURL = configuredBaseUrl
  ? configuredBaseUrl
  : pageOriginIsHttp
    ? undefined
    : "https://identity.omni.dev";

const authClient = createAuthClient({
  baseURL,
});

export default authClient;
