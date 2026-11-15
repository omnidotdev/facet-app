/**
 * Client for the Facet AI gateway's `/consent` route: set whether the signed-in
 * user opts in to sharing their prompts and generated models as AI training
 * data. The switch behind the account menu's consent toggle.
 *
 * Unlike the other AI clients this one is always authenticated and never takes a
 * BYOK key: consent is a per-user setting the gateway records against the
 * signed-in identity, so the managed bearer token is the only credential. A
 * non-success throws, so the caller can revert an optimistic toggle
 */

import { createGatewayClient } from "@omnidotdev/providers/ai-client";

export interface SetConsentOptions {
  /** Resolve the managed-path bearer token, or null when signed out. */
  getAccessToken?: () => Promise<string | null>;
}

const defaultGetAccessToken = async (): Promise<string | null> => {
  const { getAccessToken } = await import("@/lib/auth/session");
  return getAccessToken();
};

/**
 * Set the user's AI-training-data consent. Resolves to the state the gateway
 * persisted (so the UI can reconcile), or throws on any non-success. Turning
 * consent off also erases the user's previously stored samples server-side
 */
export async function setAiTrainingConsent(
  consent: boolean,
  opts: SetConsentOptions = {},
): Promise<boolean> {
  const client = createGatewayClient({
    baseUrl: import.meta.env.VITE_FACET_API_URL,
    getAccessToken: opts.getAccessToken ?? defaultGetAccessToken,
  });

  const result = await client.post<{ consent: boolean }>("consent", {
    consent,
  });
  return result.consent;
}
