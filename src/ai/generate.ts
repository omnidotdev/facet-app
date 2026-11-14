/**
 * Client for the Facet AI gateway (`facet-api`). The browser never holds
 * Facet's managed Synapse key: it calls the gateway, which owns that key and all
 * cost controls. A caller's own Synapse key (BYOK) is passed through per-request
 * over TLS and never stored.
 *
 * The HTTP plumbing (bearer on the managed path, BYOK anonymous, generic
 * user-safe errors) is the fleet-shared `createGatewayClient` from
 * `@omnidotdev/providers/ai-client`; this module only shapes Facet's request
 * body and result type. `GenerateError` is the shared `GatewayError` (same
 * message + status surface), re-exported so existing consumers are unchanged.
 */

import {
  GatewayError,
  createGatewayClient,
} from "@omnidotdev/providers/ai-client";

/** The shared gateway error, re-exported under Facet's historical name. */
export { GatewayError as GenerateError };

/**
 * A generation's output. No credit figure comes back: the Synapse gateway
 * debits the user's pooled balance, and the panel reads the refreshed balance
 */
export interface GenerateResult {
  code: string;
}

/** The prior code and its run error, fed back to the gateway for a repair pass. */
export interface GeneratePrevious {
  code: string;
  error: string;
}

/**
 * The prior code and the render critic's suggestion, fed back for a refine pass.
 * Distinct from `previous`: the code ran cleanly but a render of it did not match
 * the request, so this carries a visual improvement, not a thrown error
 */
export interface GenerateRefine {
  code: string;
  suggestion: string;
}

export interface GenerateOptions {
  /** A user-supplied Synapse key. When set, the gateway bills the caller. */
  byokKey?: string;
  /** Prior failed code plus its error, present only on a repair attempt. */
  previous?: GeneratePrevious;
  /** Prior code plus the critic's suggestion, present only on a refine pass. */
  refine?: GenerateRefine;
  /** Repair attempt counter (0 for the first generation). */
  attempt?: number;
  /**
   * Resolve the managed-path bearer token, or null when signed out. Injectable
   * for tests; defaults to the Omni session getter. Never called for a BYOK
   * request, which stays anonymous.
   */
  getAccessToken?: () => Promise<string | null>;
}

/** Lazily resolve the Omni access token, keeping the auth client out of tests. */
const defaultGetAccessToken = async (): Promise<string | null> => {
  const { getAccessToken } = await import("@/lib/auth/session");
  return getAccessToken();
};

/**
 * Generate Facet code from a plain-English prompt via the gateway. On a repair
 * attempt, pass `previous` (the failed code + its error) and an incremented
 * `attempt`. Throws a GenerateError on any non-success, carrying only the
 * gateway's generic message.
 */
export async function generateModel(
  prompt: string,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const client = createGatewayClient({
    baseUrl: import.meta.env.VITE_FACET_API_URL,
    getAccessToken: opts.getAccessToken ?? defaultGetAccessToken,
  });

  const body: Record<string, unknown> = { prompt };
  if (opts.previous) body.previous = opts.previous;
  if (opts.refine) body.refine = opts.refine;
  if (typeof opts.attempt === "number") body.attempt = opts.attempt;

  return client.post<GenerateResult>("generate", body, {
    byokKey: opts.byokKey,
  });
}
