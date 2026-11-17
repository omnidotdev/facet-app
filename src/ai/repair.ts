import { GenerateError, generateModel } from "./generate";

/**
 * Client-side repair loop. Generates Facet code, runs it through the SAME
 * editor + kernel path the Studio uses, and on a kernel error asks the gateway
 * to repair it, feeding back the failed code and its error. After the attempts
 * are spent it restores the user's prior working model rather than leaving
 * them with broken code.
 */

// Repair attempts after the initial generation. Matches the gateway's
// MAX_REPAIR_ATTEMPTS so the client never sends an attempt the server rejects
export const MAX_REPAIR_ATTEMPTS = 2;

// Shown when code generated and ran but never rendered after every repair.
// Generic on purpose: no kernel error or internal detail reaches the user
const COULD_NOT_GENERATE =
  "Could not generate a working model. Try rephrasing your request.";
const GENERIC_FAILURE = "AI generation failed. Please try again.";

/** The Studio surface the loop drives: read the editor, load + run code. */
export interface ModelRunner {
  /** The code currently in the editor, restored if every repair fails. */
  getCode: () => string;
  /** Replace the editor contents, run, and resolve with the run outcome. */
  loadCode: (code: string) => Promise<{ ok: boolean; error?: string }>;
}

export interface GenerateAndRunOptions {
  byokKey?: string;
  /** Injectable gateway client, defaulting to the real one (for tests). */
  generate?: typeof generateModel;
  /**
   * A render-critic refine pass: the prior code plus the critic's suggestion.
   * Forwarded only to the initial generate call; once the refined code throws a
   * kernel error, the repair loop takes over with `previous` instead
   */
  refine?: { code: string; suggestion: string };
  /**
   * The generation chain id to continue, so a refine pass driven from outside
   * (the panel re-enters with the critic's suggestion) stays correlated to the
   * original draft in telemetry. Omit on a first generation (the gateway mints
   * one, returned on the result)
   */
  generationId?: string;
  /** Repair attempts after the first generation. */
  maxAttempts?: number;
  /**
   * Whether to restore the editor's prior code when every attempt fails.
   * Default true, for generation that edits the current model in place. Set
   * false when generating into a fresh tab, where the prior code is just an
   * empty document: keeping the last (broken) attempt lets the user fix it,
   * and the previous model is safe in its own tab regardless
   */
  restorePriorOnFailure?: boolean;
}

export type GenerateAndRunResult =
  | { status: "ok"; repairs: number; generationId?: string }
  | {
      status: "error";
      message: string;
      httpStatus?: number;
      /** The gateway's stable error code (e.g. `payment_required`), when sent */
      errorCode?: string;
      /** Repair attempts made before the failure (calls - 1), when any call went out */
      repairs?: number;
      /** The chain id, when a first generation returned one before the failure */
      generationId?: string;
    };

/**
 * Generate code for `prompt`, run it, and repair on a kernel error up to
 * `maxAttempts` times. Returns success, or a generic, user-safe message on
 * failure (the user's prior code is kept either way).
 *
 * The managed path debits EVERY generate call (the initial one plus each
 * repair) from the user's pooled balance at the gateway. No credit figure is
 * computed here: the caller reads what was spent from the balance change
 */
export async function generateAndRun(
  prompt: string,
  runner: ModelRunner,
  opts: GenerateAndRunOptions = {},
): Promise<GenerateAndRunResult> {
  const generate = opts.generate ?? generateModel;
  const maxAttempts = opts.maxAttempts ?? MAX_REPAIR_ATTEMPTS;
  const restorePrior = opts.restorePriorOnFailure ?? true;
  const byok = opts.byokKey ? { byokKey: opts.byokKey } : {};
  const priorCode = runner.getCode();
  let touched = false;

  // Count the calls that went out, so a failure reports how many attempts ran
  let calls = 0;

  // The generation chain id: a caller-supplied one (a refine re-entry) until
  // the first result returns the gateway's, so every call in this loop (and the
  // disposition the caller later reports) correlates to one generation
  let chainId = opts.generationId;

  try {
    let result = await generate(prompt, {
      ...byok,
      ...(opts.refine ? { refine: opts.refine } : {}),
      ...(chainId ? { generationId: chainId } : {}),
    });
    calls += 1;
    touched = true;
    chainId = result.generationId ?? chainId;
    let outcome = await runner.loadCode(result.code);

    let attempt = 0;
    while (!outcome.ok && attempt < maxAttempts) {
      attempt += 1;
      result = await generate(prompt, {
        ...byok,
        previous: { code: result.code, error: outcome.error ?? "" },
        attempt,
        ...(chainId ? { generationId: chainId } : {}),
      });
      calls += 1;
      chainId = result.generationId ?? chainId;
      outcome = await runner.loadCode(result.code);
    }

    if (!outcome.ok) {
      // Keep the user's working model rather than leaving broken code behind,
      // unless the caller is generating into a fresh tab (where "prior" is an
      // empty doc and the last attempt is more useful to keep)
      if (restorePrior) await runner.loadCode(priorCode);
      return {
        status: "error",
        message: COULD_NOT_GENERATE,
        repairs: calls - 1,
        ...(chainId ? { generationId: chainId } : {}),
      };
    }

    return {
      status: "ok",
      repairs: calls - 1,
      ...(chainId ? { generationId: chainId } : {}),
    };
  } catch (err) {
    // A thrown gateway error carries a generic, user-safe message; anything
    // else is internal and must never reach the user
    if (touched && restorePrior) {
      try {
        await runner.loadCode(priorCode);
      } catch {
        // A restore failure is non-fatal; the error message still surfaces
      }
    }
    const message =
      err instanceof GenerateError ? err.message : GENERIC_FAILURE;
    // Carry the gateway status (401/402) so the caller can prompt sign-in or an
    // upgrade; a non-GenerateError throw has no status and stays generic
    const httpStatus = err instanceof GenerateError ? err.status : undefined;
    // The stable code tells "not yet a customer" apart from "out of credits"
    const errorCode = err instanceof GenerateError ? err.code : undefined;
    const extra = {
      ...(errorCode ? { errorCode } : {}),
      ...(chainId ? { generationId: chainId } : {}),
    };
    return calls > 0
      ? { status: "error", message, httpStatus, repairs: calls - 1, ...extra }
      : { status: "error", message, httpStatus, ...extra };
  }
}
