import authClient from "@/lib/auth/authClient";

/**
 * Thin session wrapper for the managed AI-generation path.
 *
 * Only the managed path (our key) needs an identity. BYOK and all local
 * modeling stay fully anonymous and never touch anything here.
 */

/** Whether Omni sign-in is configured for this deployment. */
export const isAuthConfigured = (): boolean =>
  Boolean(import.meta.env.VITE_AUTH_BASE_URL);

/**
 * Start the Omni sign-in flow, returning to the current page afterward. Matches
 * aspen-app and arbor-app: the provider is passed as `provider` to
 * `signIn.social` (better-auth 1.7 routes generic OAuth through the social path).
 */
export const signIn = async (): Promise<void> => {
  await authClient.signIn.social({
    provider: "omni",
    callbackURL: window.location.href,
  });
};

/** End the local session. */
export const signOut = async (): Promise<void> => {
  await authClient.signOut();
};

/**
 * Resolve the current Omni access token for a managed gateway call, or null
 * when signed out. The gateway (`facet-api`) resolves this bearer against
 * Gatekeeper exactly as the rest of the fleet does, so the managed path uses
 * the real mechanism rather than a bespoke scheme.
 */
export const getAccessToken = async (): Promise<string | null> => {
  const { data } = await authClient.getSession();
  return data?.session?.token ?? null;
};
