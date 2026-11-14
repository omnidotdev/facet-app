import { formatCredits } from "@omnidotdev/providers/billing";

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
 * - `outOfCredits`: 402, the user's pooled credit balance is empty
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
 * Both generation paths run through the Synapse AI router: managed uses a
 * Facet-scoped key provisioned for the signed-in user (billed to their pooled
 * Omni credits), BYOK uses the caller's own Synapse key (billed to them, no
 * credits, no sign-in). The key is
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
  /** Shown on a 402: the user's pooled credit balance is empty. */
  outOfCredits:
    "You are out of AI credits. Buy more credits to keep generating.",
  /** The out-of-credits call to action, linking to the account hub */
  buyCredits: "Buy credits",
  /** The collapsible BYOK section toggle. */
  byokToggle: "Use your own Synapse key",
  /** The BYOK key input placeholder. */
  byokPlaceholder: "Synapse API key",
} as const;

/** Catalog product id used to deep-link the billing hub to Facet's plans. */
const FACET_PRODUCT_ID = "facet";

/**
 * Resolve the shared Omni billing hub URL where an out-of-credits user buys
 * more credits, or null when no account hub is configured.
 *
 * Facet dogfoods the fleet's billing: the account hub (account.omni.dev) owns
 * billing and the pooled credit balance across every Omni product, so a top-up
 * is a link out to it rather than a bespoke in-app checkout. Returns null when `VITE_ACCOUNT_URL` is unset
 * so the caller simply omits the CTA and the panel still works
 */
export const billingHubUrl = (
  accountBaseUrl: string | undefined,
): string | null => {
  const base = accountBaseUrl?.trim().replace(/\/+$/, "");
  if (!base) return null;

  return `${base}/billing?product=${FACET_PRODUCT_ID}`;
};

/** A whole credit count with its unit, e.g. "1 credit", "1,234 credits" */
const creditCount = (credits: number): string =>
  `${formatCredits(credits)} credit${credits === 1 ? "" : "s"}`;

/**
 * The pooled balance for display, labeled as shared: one Aether balance per
 * billing account funds AI across every Omni product, not just Facet
 */
export const formatBalance = (balance: number): string =>
  `${creditCount(balance)} · shared across Omni`;

/**
 * Credits a generation spent, read from the pooled balance before and after it
 * (never computed locally). Null when either balance is unknown or the balance
 * did not go down (the gateway may not have settled yet, or a top-up landed)
 */
export const creditsSpent = (
  before: number | null,
  after: number | null,
): number | null => {
  if (before === null || after === null) return null;
  return before > after ? before - after : null;
};

/**
 * Confirmation shown (as a toast) after a successful generation, once the
 * dialog has closed so the user sees their new model.
 *
 * BYOK bills the caller's own Synapse account, not Omni credits, so it never
 * shows a credit count. The managed path shows what the balance went down by
 * when that is known. The internal repair loop is deliberately NOT surfaced:
 * "repair" is an implementation detail a user has no model for, so the toast
 * reports only the cost, never the attempt count
 */
export const formatGeneratedToast = (
  spent: number | null,
  byok: boolean,
): string => {
  if (byok) return "Generated with your Synapse key";
  return spent ? `Generated · ${creditCount(spent)}` : "Generated";
};

/**
 * Prepend a provenance header to AI-generated code so a generated model is
 * self-documenting: it records that Facet AI wrote it, when, and the prompt it
 * came from, which survives export and helps a user recall intent later.
 *
 * Applied only when loading generated code into the editor, never fed back into
 * the repair loop, so the gateway always sees clean code. A multi-line prompt is
 * commented line by line
 */
export const withProvenanceHeader = (code: string, prompt: string): string => {
  const date = new Date().toISOString().slice(0, 10);
  const promptBody = prompt
    .trim()
    .split("\n")
    .map((line) => `//   ${line}`)
    .join("\n");
  return `// Generated by Facet AI · ${date}\n// Prompt:\n${promptBody}\n\n${code}`;
};

/**
 * Note shown in the dialog when a generation failed but the balance still went
 * down: the managed path is charged per attempt even when the model never
 * renders, so the spend is surfaced rather than silent.
 */
export const formatSpentNote = (credits: number): string =>
  `${creditCount(credits)} spent.`;

/**
 * Starter prompts offered in an empty Describe-a-part dialog. Plain-English
 * one-liners spanning the kernel's range (a primitive, a boolean cut, a
 * threaded-looking part, a studded brick, a rounded shape) so a new user gets
 * a working first generation in one click instead of facing a blank box. Kept
 * here so the set is covered by a test
 */
export const PROMPT_SUGGESTIONS = [
  "a 20mm cube with a 6mm hole through the middle",
  "an L-bracket with two bolt holes",
  "a hex nut for an M10 bolt",
  "a 2x4 LEGO-style brick",
  "a rounded desk phone stand",
] as const;
