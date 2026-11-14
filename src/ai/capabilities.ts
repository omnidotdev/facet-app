/**
 * Ask the gateway what the signed-in user may do, so the Studio can show the
 * "describe a part" panel only to users who can actually use managed generation
 * (the server's env allowlist) instead of showing it to everyone and failing
 * with a 403. The allowlist never reaches the client; only the caller's own
 * yes/no does. Fails closed (no capability) on any error.
 */

/**
 * The signed-in user's real credit balance: ONE pooled Aether balance per
 * billing account, shared across every Omni product, in whole display credits
 * (already converted and rounded down by the gateway). Facet keeps no ledger
 */
export interface CreditBalance {
  balance: number;
}

export interface Capabilities {
  signedIn: boolean;
  managedGeneration: boolean;
  /** The user's Facet tier (e.g. "free", "pro"), present for a managed user */
  tier?: string;
  /** The pooled credit balance, present only when the gateway could read it */
  credits?: CreditBalance;
}

const NONE: Capabilities = { signedIn: false, managedGeneration: false };

/** Lazily resolve the Omni access token, keeping the auth client out of tests. */
const defaultGetAccessToken = async (): Promise<string | null> => {
  const { getAccessToken } = await import("@/lib/auth/session");
  return getAccessToken();
};

export async function fetchCapabilities(
  getAccessToken: () => Promise<string | null> = defaultGetAccessToken,
): Promise<Capabilities> {
  const baseUrl = import.meta.env.VITE_FACET_API_URL;
  if (!baseUrl) return NONE;

  const token = await getAccessToken().catch(() => null);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/capabilities`, {
      headers,
    });
    if (!res.ok) return NONE;
    const data = (await res.json()) as {
      signedIn?: unknown;
      managedGeneration?: unknown;
      tier?: unknown;
      credits?: { balance?: unknown };
    };
    // Only trust a finite numeric balance; anything else is omitted so the
    // panel simply shows no balance rather than a broken one
    const balance = data.credits?.balance;
    const credits =
      typeof balance === "number" && Number.isFinite(balance)
        ? { balance }
        : undefined;
    const tier = typeof data.tier === "string" ? data.tier : undefined;
    return {
      signedIn: Boolean(data.signedIn),
      managedGeneration: Boolean(data.managedGeneration),
      ...(tier ? { tier } : {}),
      ...(credits ? { credits } : {}),
    };
  } catch {
    return NONE;
  }
}
