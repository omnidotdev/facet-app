import { describe, expect, test } from "bun:test";

import { runCritiqueLoop } from "./critiqueLoop";

import type { Critique, CritiqueImage } from "./critique";
import type { CritiqueLoopDeps, CritiqueLoopStep } from "./critiqueLoop";

const IMG: CritiqueImage = { mediaType: "image/png", data: "aGVsbG8=" };

const verdict = (over: Partial<Critique> = {}): Critique => ({
  ok: false,
  score: 0.3,
  issues: ["reads as a letter"],
  suggestedFix: "use text() instead of a hand-drawn path",
  ...over,
});

/**
 * Build injected deps: `codes` are the successive generate() outputs, `verdicts`
 * the successive critique() outputs. Records every call for assertions
 */
const makeDeps = (
  codes: string[],
  verdicts: Critique[],
  over: Partial<CritiqueLoopDeps> = {},
) => {
  let gen = 0;
  let crit = 0;
  const refines: {
    previousCode: string;
    suggestion: string;
    attempt: number;
  }[] = [];
  const shown: string[] = [];
  const steps: CritiqueLoopStep[] = [];
  const deps: CritiqueLoopDeps = {
    generate: async (_prompt, refine) => {
      if (refine) refines.push(refine);
      return { code: codes[gen++] ?? codes[codes.length - 1]! };
    },
    showCode: async (code) => {
      shown.push(code);
    },
    capture: () => IMG,
    critique: async () => verdicts[crit++] ?? verdicts[verdicts.length - 1]!,
    onStep: (s) => steps.push(s),
    ...over,
  };
  return { deps, refines, shown, steps };
};

describe("runCritiqueLoop", () => {
  test("accepts on the first critique and never refines", async () => {
    const { deps, refines } = makeDeps(["codeA"], [verdict({ ok: true })]);
    const res = await runCritiqueLoop("scorpio", deps);
    expect(res.stoppedBecause).toBe("accepted");
    expect(res.code).toBe("codeA");
    expect(res.refined).toBe(false);
    expect(res.critiques.length).toBe(1);
    expect(refines).toEqual([]);
  });

  test("refines once with the suggestion, then accepts", async () => {
    const { deps, refines, shown } = makeDeps(
      ["codeA", "codeB"],
      [
        verdict({ ok: false, suggestedFix: "fix the tail" }),
        verdict({ ok: true }),
      ],
    );
    const res = await runCritiqueLoop("scorpio", deps, { maxRefines: 1 });
    expect(res.stoppedBecause).toBe("accepted");
    expect(res.code).toBe("codeB");
    expect(res.refined).toBe(true);
    expect(refines).toEqual([
      { previousCode: "codeA", suggestion: "fix the tail", attempt: 1 },
    ]);
    expect(shown).toEqual(["codeA", "codeB"]);
  });

  test("stops at the refine budget when never accepted", async () => {
    const { deps, refines } = makeDeps(
      ["c0", "c1", "c2"],
      [verdict(), verdict(), verdict()],
    );
    const res = await runCritiqueLoop("x", deps, { maxRefines: 2 });
    expect(res.stoppedBecause).toBe("budget");
    expect(res.code).toBe("c2");
    expect(res.critiques.length).toBe(3);
    expect(refines.length).toBe(2);
  });

  test("stops without critiquing when capture is unavailable", async () => {
    const { deps } = makeDeps(["codeA"], [verdict()], { capture: () => null });
    const res = await runCritiqueLoop("x", deps);
    expect(res.stoppedBecause).toBe("no-capture");
    expect(res.critiques).toEqual([]);
    expect(res.code).toBe("codeA");
  });

  test("stops when the critic offers no actionable fix", async () => {
    const { deps, refines } = makeDeps(
      ["codeA"],
      [verdict({ ok: false, suggestedFix: null })],
    );
    const res = await runCritiqueLoop("x", deps, { maxRefines: 2 });
    expect(res.stoppedBecause).toBe("no-suggestion");
    expect(refines).toEqual([]);
  });

  test("emits steps in order: generated -> critiqued -> refining -> critiqued", async () => {
    const { deps, steps } = makeDeps(
      ["codeA", "codeB"],
      [verdict({ ok: false, suggestedFix: "s" }), verdict({ ok: true })],
    );
    await runCritiqueLoop("x", deps, { maxRefines: 1 });
    expect(steps.map((s) => s.phase)).toEqual([
      "generated",
      "critiqued",
      "refining",
      "critiqued",
    ]);
  });

  test("maxRefines is clamped to 0..3", async () => {
    const { deps, refines } = makeDeps(
      Array.from({ length: 8 }, (_, i) => `c${i}`),
      Array.from({ length: 8 }, () => verdict()),
    );
    const res = await runCritiqueLoop("x", deps, { maxRefines: 99 });
    expect(refines.length).toBe(3); // clamped
    expect(res.stoppedBecause).toBe("budget");
  });
});
