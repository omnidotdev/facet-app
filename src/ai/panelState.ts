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
 * - `signIn`: 401, the managed path needs an identity (or a fresh sign-in)
 * - `outOfCredits`: 402, the workspace's pooled credit balance is empty
 * - `planRequired`: 403, the workspace's plan does not include this
 * - `usageLimit`: 429, a usage limit was reached
 * - `generic`: anything else, shown as the message the gateway already returned
 *
 * Every non-`signIn` action shows the gateway's own (user-safe) message, except
 * `outOfCredits`, which has fixed copy and a Buy credits link
 */
export type GenerateErrorAction =
  | "signIn"
  | "outOfCredits"
  | "planRequired"
  | "usageLimit"
  | "generic";

/** Map a gateway HTTP status onto the panel's reaction. */
export const classifyGenerateError = (
  status: number | undefined,
): GenerateErrorAction => {
  if (status === 401) return "signIn";
  if (status === 402) return "outOfCredits";
  if (status === 403) return "planRequired";
  if (status === 429) return "usageLimit";
  return "generic";
};

/** A billing refusal from a step that runs after a successful first draft */
export type FollowUpAction = Extract<
  GenerateErrorAction,
  "outOfCredits" | "planRequired" | "usageLimit"
>;

/**
 * Whether a failed post-draft step (the render check, or the refine it asks
 * for) is a billing refusal the user must see. Those steps are advisory, so
 * anything else stays silent and the draft simply stands
 */
export const followUpAction = (
  status: number | undefined,
): FollowUpAction | null => {
  const action = classifyGenerateError(status);
  return action === "outOfCredits" ||
    action === "planRequired" ||
    action === "usageLimit"
    ? action
    : null;
};

/**
 * The notice shown when a post-draft step was refused: the draft is kept in the
 * editor, so lead with that, then say why it was not checked or refined
 * @param action - The refusal
 * @param message - The gateway's user-safe message for it
 */
export const followUpNotice = (
  action: FollowUpAction,
  message: string,
): string =>
  action === "outOfCredits"
    ? PANEL_COPY.outOfCreditsAfterDraft
    : `${PANEL_COPY.draftKept} ${message}`;

/** The tier that is offered an upgrade to Pro */
const FREE_TIER = "free";

/** Whether the Upgrade to Pro entry point shows for a tier (free only) */
export const canUpgrade = (tier: string | undefined): boolean =>
  tier === FREE_TIER;

/** Which billing links a failure notice carries */
export interface NoticeLinks {
  buyCredits: boolean;
  upgrade: boolean;
}

/**
 * The billing links for a failure notice. Out of credits offers credits (and
 * an upgrade on the free tier); a plan refusal offers an upgrade unless the
 * tier is known to be paid already; a usage limit offers an upgrade on the free
 * tier. Anything else carries no billing link
 */
export const noticeLinks = (
  action: GenerateErrorAction | null,
  tier: string | undefined,
): NoticeLinks => {
  switch (action) {
    case "outOfCredits":
      return { buyCredits: true, upgrade: canUpgrade(tier) };
    case "planRequired":
      return {
        buyCredits: false,
        upgrade: tier === undefined || canUpgrade(tier),
      };
    case "usageLimit":
      return { buyCredits: false, upgrade: canUpgrade(tier) };
    default:
      return { buyCredits: false, upgrade: false };
  }
};

/**
 * Whether a refreshed balance clears the out-of-credits notice: the user
 * bought credits (usually in another tab) and the balance is positive again
 */
export const shouldClearOutOfCredits = (
  action: GenerateErrorAction | null,
  balance: number | null,
): boolean => action === "outOfCredits" && balance !== null && balance > 0;

/**
 * A leading-edge throttle: the returned function says whether a call may run
 * now, allowing at most one per `intervalMs`
 * @param intervalMs - Minimum time between allowed calls
 * @param now - Clock (epoch ms), injectable for tests
 */
export const createThrottle = (
  intervalMs: number,
  now: () => number = Date.now,
): (() => boolean) => {
  let last: number | null = null;
  return () => {
    const t = now();
    if (last !== null && t - last < intervalMs) return false;
    last = t;
    return true;
  };
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
 * The Synapse product page, linked from the panel's "generation runs through
 * Synapse" line so the router is a visible, clickable part of the flow rather
 * than opaque plumbing. Same host as the key dashboard today, kept as its own
 * constant so the description link and the BYOK key link can diverge later
 */
export const SYNAPSE_URL = "https://synapse.omni.dev";

/**
 * The steps of a managed generation, surfaced to the user as a live status so a
 * multi-call run (generate, then a vision check of the render, then an optional
 * refine) reads as progress instead of one long frozen spinner.
 */
export type GeneratePhase = "generating" | "checking" | "refining";

/**
 * The plain-English status shown beside the spinner for each phase. No trailing
 * ellipsis; the spinner already carries the "in progress" sense. The vision
 * critique is framed as "checking the render", never exposing the under-the-hood
 * critic, and the refine is framed as improving accuracy
 */
export const phaseLabel = (phase: GeneratePhase): string => {
  switch (phase) {
    case "generating":
      return "Generating your part";
    case "checking":
      return "Checking the render";
    case "refining":
      return "Refining for accuracy";
  }
};

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
  /** The free-tier call to action, opening Facet Pro checkout in the hub */
  upgrade: "Upgrade to Pro",
  /** Leads a post-draft refusal: the successful draft is never discarded */
  draftKept: "Your part is ready in the editor.",
  /** Shown when the render check or refine ran out of credits after a draft */
  outOfCreditsAfterDraft:
    "Your part is ready in the editor, but you ran out of AI credits before it could be checked. Buy more credits to keep generating.",
  /** The collapsible BYOK section toggle. */
  byokToggle: "Use your own Synapse key",
  /** The BYOK key input placeholder. */
  byokPlaceholder: "Synapse API key",
} as const;

/** Catalog product id used to deep-link the billing hub to Facet's plans. */
const FACET_PRODUCT_ID = "facet";

/** The paid plan the Upgrade entry point checks out, billed monthly */
const PRO_PLAN = "pro";
const PRO_INTERVAL = "month";

/** The account hub's base URL without a trailing slash, or null when unset */
const hubBase = (accountBaseUrl: string | undefined): string | null => {
  const base = accountBaseUrl?.trim().replace(/\/+$/, "");
  return base ? base : null;
};

/**
 * Resolve the shared Omni billing hub URL where an out-of-credits user buys
 * more credits, or null when no account hub is configured.
 *
 * Facet dogfoods the fleet's billing: the account hub (account.omni.dev) owns
 * billing and the pooled credit balance across every Omni product, so a top-up
 * is a link out to it rather than a bespoke in-app checkout. `tab=ai` opens the
 * hub on its credits section, and the workspace slug selects the personal
 * workspace Facet bills, so a purchase lands in the balance Facet spends. An
 * older gateway sends no slug; the link then opens the hub's default account.
 * Returns null when `VITE_ACCOUNT_URL` is unset so the caller omits the CTA
 * @param accountBaseUrl - The account hub base URL
 * @param workspaceSlug - The personal workspace Facet bills, when known
 */
export const billingHubUrl = (
  accountBaseUrl: string | undefined,
  workspaceSlug?: string,
): string | null => {
  const base = hubBase(accountBaseUrl);
  if (!base) return null;

  const params = new URLSearchParams({ product: FACET_PRODUCT_ID, tab: "ai" });
  if (workspaceSlug) params.set("workspace", workspaceSlug);
  return `${base}/billing?${params.toString()}`;
};

/**
 * Resolve the account hub link that buys Facet Pro, or null when no account
 * hub is configured. The hub answers it with Stripe Checkout for Facet Pro on
 * the named workspace and sends the user back to `returnUrl` afterwards (the
 * hub only honors first-party Omni https origins there). Without a workspace
 * the hub asks which one to upgrade; without a return URL it stays in the hub
 * @param accountBaseUrl - The account hub base URL
 * @param options - The workspace to upgrade and where to return, when known
 */
export const upgradeUrl = (
  accountBaseUrl: string | undefined,
  { workspaceSlug, returnUrl }: { workspaceSlug?: string; returnUrl?: string },
): string | null => {
  const base = hubBase(accountBaseUrl);
  if (!base) return null;

  const params = new URLSearchParams({
    product: FACET_PRODUCT_ID,
    plan: PRO_PLAN,
    interval: PRO_INTERVAL,
  });
  if (workspaceSlug) params.set("workspace", workspaceSlug);
  if (returnUrl) params.set("return", returnUrl);
  return `${base}/billing?${params.toString()}`;
};

/**
 * Where the hub returns after a Facet Pro checkout: the Studio on the current
 * origin. Undefined without a usable http(s) origin (the desktop shell's custom
 * scheme can not be returned to, so the hub keeps the user there instead)
 * @param origin - The page origin (`window.location.origin`)
 */
export const studioReturnUrl = (
  origin: string | undefined,
): string | undefined => {
  if (!origin) return undefined;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  return `${url.origin.toLowerCase()}/studio`;
};

/** A whole credit count with its unit, e.g. "1 credit", "1,234 credits" */
export const creditCount = (credits: number): string =>
  `${formatCredits(credits)} credit${credits === 1 ? "" : "s"}`;

/**
 * The pooled balance for display: just the number and its unit. One Aether
 * balance per billing account funds AI across every Omni product, not just
 * Facet; that context is BALANCE_CAPTION, rendered as a separate caption rather
 * than joined on with a separator, so the panel can place the figure and its
 * note in their own strategic spots
 */
export const formatBalance = (balance: number): string => creditCount(balance);

/** Caption clarifying the balance is one pool shared across every Omni product */
export const BALANCE_CAPTION = "shared across Omni";

/**
 * An honest per-run cost hint, phrased as an estimate. Based on what the user's
 * LAST managed generation actually debited, so it self-calibrates to the real
 * model and loop cost instead of a hardcoded number that silently drifts when
 * the model or critique budget changes. Falls back to a soft range before any
 * run has happened. Null-safe
 */
export const formatPerPartEstimate = (lastSpend: number | null): string =>
  lastSpend && lastSpend > 0
    ? `about ${creditCount(lastSpend)} per part`
    : "usually a few credits per part";

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
  return spent ? `Generated (${creditCount(spent)})` : "Generated";
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
