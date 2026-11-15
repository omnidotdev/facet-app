/**
 * Client for the Facet AI gateway's `/disposition` route: report what the user
 * did with a generation (kept it, discarded it, regenerated), the one quality
 * signal the gateway cannot see on its own. It is the human-in-the-loop label
 * that turns raw usage telemetry into "what share of drafts does a user keep?".
 *
 * Mirrors `generate.ts`: the HTTP plumbing is the fleet-shared
 * `createGatewayClient`, and a BYOK request stays anonymous. Reporting is pure
 * telemetry: it never blocks the UI and a failure is swallowed, so a dropped
 * signal never surfaces as a user-facing error
 */

import { createGatewayClient } from "@omnidotdev/providers/ai-client";

/**
 * What the user did with a generation:
 * - `kept`: the generated code was applied and left in place (the implicit accept)
 * - `discarded`: dismissed without keeping the result
 * - `regenerated`: triggered another pass
 */
export type Disposition = "kept" | "discarded" | "regenerated";

export interface DispositionOptions {
  /** A user-supplied Synapse key; keeps a BYOK report anonymous like generate. */
  byokKey?: string;
  /** Resolve the managed-path bearer token, or null when signed out. */
  getAccessToken?: () => Promise<string | null>;
}

const defaultGetAccessToken = async (): Promise<string | null> => {
  const { getAccessToken } = await import("@/lib/auth/session");
  return getAccessToken();
};

/**
 * Report a generation's disposition, correlated by `generationId`. Best-effort
 * and fire-and-forget: resolves to true on success, false on any failure, and
 * never throws, so a caller can `void` it without guarding. Does nothing when
 * no generation id is known (e.g. an older gateway that returned none)
 */
export async function reportDisposition(
  generationId: string | undefined,
  disposition: Disposition,
  opts: DispositionOptions = {},
): Promise<boolean> {
  if (!generationId) return false;

  try {
    const client = createGatewayClient({
      baseUrl: import.meta.env.VITE_FACET_API_URL,
      getAccessToken: opts.getAccessToken ?? defaultGetAccessToken,
    });
    await client.post(
      "disposition",
      { generationId, disposition },
      { byokKey: opts.byokKey },
    );
    return true;
  } catch {
    // Telemetry is advisory; a lost disposition never affects the user
    return false;
  }
}
