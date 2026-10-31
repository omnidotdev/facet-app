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
 * When `VITE_AUTH_BASE_URL` is unset the client falls back to the page origin,
 * which has no auth server, so every session read resolves to signed-out and
 * only the BYOK path works. That keeps local modeling and BYOK fully anonymous.
 */
const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_AUTH_BASE_URL,
});

export default authClient;
