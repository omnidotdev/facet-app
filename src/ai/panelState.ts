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

/**
 * Where a user mints their own Synapse key for BYOK generation.
 *
 * Both generation paths run through the Synapse AI router: managed uses Facet's
 * server-side Synapse key (metered against Facet credits), BYOK uses the
 * caller's own Synapse key (billed to them, no meter, no sign-in). The key is
 * NOT a raw provider key: the gateway forwards it to Synapse with Synapse's
 * provider-prefixed model id, so only a Synapse key resolves
 */
export const SYNAPSE_KEY_URL = "https://synapse.omni.dev";

/**
 * User-facing panel copy, kept here so it is covered by tests and cannot
 * silently regress to the old (wrong) "provider key" framing. Generic and
 * user-safe; terminology is "workspace", never "organization"
 */
export const PANEL_COPY = {
  /** Shown on a 401: the managed path needs an Omni identity. */
  signInPrompt:
    "Sign in to use managed generation, or add your own Synapse key below.",
  /** Shown on a 402: the monthly managed credit cap is reached. */
  outOfCredits:
    "You are out of AI credits for this month. Upgrade your workspace plan for more, or add your own Synapse key below.",
  /** The collapsible BYOK section toggle. */
  byokToggle: "Use your own Synapse key",
  /** The BYOK key input placeholder. */
  byokPlaceholder: "Synapse API key",
} as const;

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

/** Pluralize a credit count for display, e.g. "1 credit", "3 credits". */
const formatCredits = (credits: number): string =>
  `${credits} credit${credits === 1 ? "" : "s"}`;

/**
 * Confirmation shown (as a toast) after a successful generation, once the
 * dialog has closed so the user sees their new model.
 *
 * BYOK bills the caller's own Synapse account, not Facet credits, so it never
 * shows a credit count. The managed path shows the TOTAL credits spent across
 * the initial call plus any repairs, with the repair count so a larger-than-
 * expected number is explained rather than surprising
 */
export const formatGeneratedToast = (
  credits: number,
  repairs: number,
  byok: boolean,
): string => {
  if (byok) return "Generated with your Synapse key";
  const base = `Generated · ${formatCredits(credits)}`;
  if (repairs <= 0) return base;
  return `${base} · ${repairs} repair${repairs === 1 ? "" : "s"}`;
};

/**
 * Note shown in the dialog when a generation failed but still billed credits:
 * the managed path is charged per attempt even when the model never renders,
 * so the spend is surfaced rather than silent.
 */
export const formatSpentNote = (credits: number): string =>
  `${formatCredits(credits)} spent.`;
