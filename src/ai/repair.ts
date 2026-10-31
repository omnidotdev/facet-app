import { GenerateError, generateModel } from "./generate";

import type { GenerateResult } from "./generate";

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
  /** Repair attempts after the first generation. */
  maxAttempts?: number;
}

export type GenerateAndRunResult =
  | { status: "ok"; usage: GenerateResult["usage"] }
  | { status: "error"; message: string; httpStatus?: number };

/**
 * Generate code for `prompt`, run it, and repair on a kernel error up to
 * `maxAttempts` times. Returns the metered usage on success, or a generic,
 * user-safe message on failure (the user's prior code is kept either way).
 */
export async function generateAndRun(
  prompt: string,
  runner: ModelRunner,
  opts: GenerateAndRunOptions = {},
): Promise<GenerateAndRunResult> {
  const generate = opts.generate ?? generateModel;
  const maxAttempts = opts.maxAttempts ?? MAX_REPAIR_ATTEMPTS;
  const byok = opts.byokKey ? { byokKey: opts.byokKey } : {};
  const priorCode = runner.getCode();
  let touched = false;

  try {
    let result = await generate(prompt, { ...byok });
    touched = true;
    let outcome = await runner.loadCode(result.code);

    let attempt = 0;
    while (!outcome.ok && attempt < maxAttempts) {
      attempt += 1;
      result = await generate(prompt, {
        ...byok,
        previous: { code: result.code, error: outcome.error ?? "" },
        attempt,
      });
      outcome = await runner.loadCode(result.code);
    }

    if (!outcome.ok) {
      // Keep the user's working model rather than leaving broken code behind
      await runner.loadCode(priorCode);
      return { status: "error", message: COULD_NOT_GENERATE };
    }

    return { status: "ok", usage: result.usage };
  } catch (err) {
    // A thrown gateway error carries a generic, user-safe message; anything
    // else is internal and must never reach the user
    if (touched) {
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
    return { status: "error", message, httpStatus };
  }
}
