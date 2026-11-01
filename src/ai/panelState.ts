/**
 * Pure state logic for the "Describe a part" panel, kept out of the component
 * so it can be unit-tested without a DOM. The panel renders one of three modes
 * and maps the gateway's typed errors onto user actions.
 */

/**
 * What the panel offers the user:
 * - `generate`: signed in or a BYOK key is set, so Generate runs as normal
 * - `signIn`: no identity and no key, but sign-in is available
 * - `needsKey`: no identity, no key, and sign-in is not configured, so BYOK is
 *   the only way to generate
 */
export type PanelMode = "generate" | "signIn" | "needsKey";

export interface PanelModeInput {
  /** Whether Omni sign-in is configured for this deployment. */
  authConfigured: boolean;
  /** Whether a user session is present. */
  signedIn: boolean;
  /** Whether a non-empty BYOK key is set. */
  hasByok: boolean;
}

/** Resolve which affordance the panel shows. */
export const resolvePanelMode = ({
  authConfigured,
  signedIn,
  hasByok,
}: PanelModeInput): PanelMode => {
  if (signedIn || hasByok) return "generate";
  if (authConfigured) return "signIn";
  return "needsKey";
};

/**
 * How the panel should react to a failed generation, derived from the gateway's
 * HTTP status (carried on the typed GenerateError):
 * - `signIn`: 401, the managed path needs an identity
 * - `outOfCredits`: 402, the monthly credit cap is reached
 * - `generic`: anything else, shown as the message the gateway already returned
 */
export type GenerateErrorAction = "signIn" | "outOfCredits" | "generic";

/** Map a gateway HTTP status onto the panel's reaction. */
export const classifyGenerateError = (
  status: number | undefined,
): GenerateErrorAction => {
  if (status === 401) return "signIn";
  if (status === 402) return "outOfCredits";
  return "generic";
};

/** Catalog product id used to deep-link the billing hub to Facet's plans. */
const FACET_PRODUCT_ID = "facet";

/**
 * Resolve the shared Omni billing hub URL that funnels an out-of-credits user
 * to Facet Pro, or null when no account hub is configured.
 *
 * Facet dogfoods the fleet's billing: the account hub (account.omni.dev) owns
 * billing across every Omni product, so an upgrade is a link out to it rather
 * than a bespoke in-app checkout. Returns null when `VITE_ACCOUNT_URL` is unset
 * so the caller simply omits the CTA and the panel still works
 */
export const billingHubUrl = (
  accountBaseUrl: string | undefined,
): string | null => {
  const base = accountBaseUrl?.trim().replace(/\/+$/, "");
  if (!base) return null;

  return `${base}/billing?product=${FACET_PRODUCT_ID}`;
};
