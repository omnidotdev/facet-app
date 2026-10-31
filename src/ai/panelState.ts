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
