/**
 * The render-and-critique generation loop, as pure orchestration.
 *
 * Instead of trusting one blind generation, ground it: generate -> show the code
 * in the Studio so the viewport renders it -> capture that render -> ask the
 * vision critic whether it matches the request -> if not, refine (regenerate
 * with the critic's suggestion) -> repeat up to a small budget. This is what
 * scales quality beyond glyphs, to any shape.
 *
 * Every effectful step is injected, so the loop is deterministic and fully
 * unit-testable without a GPU, a kernel, or the network. The caller wires the
 * real `generate`/`showCode`/`capture`/`critique` in the Studio
 */

import type { Critique, CritiqueImage } from "./critique";

export interface CritiqueLoopDeps {
  /** Generate code for the prompt; on a refine, `suggestion` carries the critic's fix. */
  generate: (
    prompt: string,
    refine?: { previousCode: string; suggestion: string; attempt: number },
  ) => Promise<{ code: string }>;
  /**
   * Evaluate `code` so the viewport renders it. Resolves once a frame reflecting
   * this code has been drawn (so the subsequent capture is of this geometry)
   */
  showCode: (code: string) => Promise<void>;
  /** Capture the current render, or null when capture is unavailable. */
  capture: () => Promise<CritiqueImage | null> | CritiqueImage | null;
  /** Ask the critic whether the render of `code` matches the prompt. */
  critique: (
    prompt: string,
    code: string,
    image: CritiqueImage,
  ) => Promise<Critique>;
  /** Fired as the loop advances, for UI (e.g. "refining..."). Optional. */
  onStep?: (step: CritiqueLoopStep) => void;
}

export type CritiqueLoopStep =
  | { phase: "generated"; code: string }
  | { phase: "critiqued"; critique: Critique; attempt: number }
  | { phase: "refining"; suggestion: string; attempt: number };

export interface CritiqueLoopResult {
  /** The best code the loop arrived at. */
  code: string;
  /** Each verdict, in order; empty if critique never ran (no capture). */
  critiques: Critique[];
  /** Whether at least one refine pass ran. */
  refined: boolean;
  /** Why the loop stopped. */
  stoppedBecause: "accepted" | "budget" | "no-capture" | "no-suggestion";
}

export interface CritiqueLoopOptions {
  /** Max refine passes after the first generation (default 1, clamped 0..3). */
  maxRefines?: number;
}

/**
 * Run the loop for `prompt`. Always does one generation; then up to `maxRefines`
 * critique-and-refine passes, stopping as soon as the critic accepts the result
 * (or capture is unavailable, or the critic offers no actionable fix)
 */
export async function runCritiqueLoop(
  prompt: string,
  deps: CritiqueLoopDeps,
  options: CritiqueLoopOptions = {},
): Promise<CritiqueLoopResult> {
  const maxRefines = Math.max(0, Math.min(3, options.maxRefines ?? 1));
  const critiques: Critique[] = [];
  let refined = false;

  let { code } = await deps.generate(prompt);
  deps.onStep?.({ phase: "generated", code });

  for (let attempt = 0; attempt <= maxRefines; attempt += 1) {
    await deps.showCode(code);
    const image = await deps.capture();
    if (!image) {
      return { code, critiques, refined, stoppedBecause: "no-capture" };
    }

    const verdict = await deps.critique(prompt, code, image);
    critiques.push(verdict);
    deps.onStep?.({ phase: "critiqued", critique: verdict, attempt });

    if (verdict.ok) {
      return { code, critiques, refined, stoppedBecause: "accepted" };
    }
    if (attempt === maxRefines) {
      return { code, critiques, refined, stoppedBecause: "budget" };
    }
    if (!verdict.suggestedFix) {
      return { code, critiques, refined, stoppedBecause: "no-suggestion" };
    }

    deps.onStep?.({
      phase: "refining",
      suggestion: verdict.suggestedFix,
      attempt: attempt + 1,
    });
    const next = await deps.generate(prompt, {
      previousCode: code,
      suggestion: verdict.suggestedFix,
      attempt: attempt + 1,
    });
    code = next.code;
    refined = true;
  }

  // unreachable: the loop returns inside the body, but satisfies the type
  return { code, critiques, refined, stoppedBecause: "budget" };
}
