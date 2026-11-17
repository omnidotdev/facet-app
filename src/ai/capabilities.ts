/**
 * Ask the gateway what the signed-in user may do, so the Studio can show the
 * "describe a part" panel in the right state: generating for a paying customer
 * (Facet Pro, or a workspace that bought Omni credits), a paid-access state for
 * a signed-in user who is not one yet, and nothing for anyone else. Only the
 * caller's own answer reaches the client. Fails closed (no capability) on any
 * error.
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
  /**
   * Whether the user has opted in to sharing their prompts and generated models
   * as AI training data (default off). Present for a managed user; drives the
   * account menu's consent toggle
   */
  aiTrainingConsent?: boolean;
  /**
   * The personal workspace Facet bills (an Omni organization), present for a
   * managed user against a gateway that reports it. Used to deep-link the
   * account hub's credits and plan checkout to that workspace
   */
  workspace?: { slug: string };
  /**
   * Set when the user is signed in but not yet a paying customer, so managed
   * generation needs credits or Facet Pro first (BYOK still works). Absent from
   * an older gateway
   */
  paymentRequired?: boolean;
  /**
   * Set when the session is signed in but its token predates the workspace
   * claim, so the user must sign in again before managed generation works
   */
  reauthRequired?: boolean;
}

/** A workspace slug as the account hub accepts it (lowercase, dashed) */
const isWorkspaceSlug = (value: string): boolean =>
  value.length <= 100 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);

/** Read the workspace slug from the gateway's answer, or undefined */
const parseWorkspace = (value: unknown): { slug: string } | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const slug = (value as { slug?: unknown }).slug;
  if (typeof slug !== "string") return undefined;
  const lowered = slug.toLowerCase();
  return isWorkspaceSlug(lowered) ? { slug: lowered } : undefined;
};

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
      aiTrainingConsent?: unknown;
      workspace?: unknown;
      paymentRequired?: unknown;
      reauthRequired?: unknown;
    };
    // Only trust a finite numeric balance; anything else is omitted so the
    // panel simply shows no balance rather than a broken one
    const balance = data.credits?.balance;
    const credits =
      typeof balance === "number" && Number.isFinite(balance)
        ? { balance }
        : undefined;
    const tier = typeof data.tier === "string" ? data.tier : undefined;
    // Only a real boolean drives the toggle; absence leaves it off and hidden
    const aiTrainingConsent =
      typeof data.aiTrainingConsent === "boolean"
        ? data.aiTrainingConsent
        : undefined;
    // An older gateway sends no workspace; links then omit it
    const workspace = parseWorkspace(data.workspace);
    return {
      signedIn: Boolean(data.signedIn),
      managedGeneration: Boolean(data.managedGeneration),
      ...(tier ? { tier } : {}),
      ...(credits ? { credits } : {}),
      ...(aiTrainingConsent !== undefined ? { aiTrainingConsent } : {}),
      ...(workspace ? { workspace } : {}),
      ...(data.paymentRequired === true ? { paymentRequired: true } : {}),
      ...(data.reauthRequired === true ? { reauthRequired: true } : {}),
    };
  } catch {
    return NONE;
  }
}
