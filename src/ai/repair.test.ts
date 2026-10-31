import { describe, expect, test } from "bun:test";

import { GenerateError } from "./generate";
import { MAX_REPAIR_ATTEMPTS, generateAndRun } from "./repair";

import type { GenerateOptions, GenerateResult } from "./generate";
import type { ModelRunner } from "./repair";

/** A runner that records loaded code and returns a scripted outcome per load. */
function fakeRunner(
  outcomes: Array<{ ok: boolean; error?: string }>,
  priorCode = "return cube(1);",
): ModelRunner & { loaded: string[] } {
  const loaded: string[] = [];
  let i = 0;
  return {
    loaded,
    getCode: () => priorCode,
    loadCode: (code: string) => {
      loaded.push(code);
      // Restores (prior code) reuse the last scripted outcome
      const outcome = outcomes[i] ??
        outcomes[outcomes.length - 1] ?? { ok: true };
      i += 1;
      return Promise.resolve(outcome);
    },
  };
}

/** A generate stub that records calls and yields `codes` in order. */
function fakeGenerate(codes: string[]) {
  const calls: Array<{ prompt: string; opts: GenerateOptions }> = [];
  let i = 0;
  const fn = (
    prompt: string,
    opts: GenerateOptions = {},
  ): Promise<GenerateResult> => {
    calls.push({ prompt, opts });
    const code = codes[Math.min(i, codes.length - 1)];
    i += 1;
    return Promise.resolve({
      code: code ?? "",
      usage: { credits: 3, costCents: 2.5 },
    });
  };
  return { fn, calls };
}

describe("generateAndRun", () => {
  test("generates, runs once, and returns usage on success", async () => {
    const { fn, calls } = fakeGenerate(["return cube(10);"]);
    const runner = fakeRunner([{ ok: true }]);

    const result = await generateAndRun("a cube", runner, { generate: fn });

    expect(result).toEqual({
      status: "ok",
      usage: { credits: 3, costCents: 2.5 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.opts.previous).toBeUndefined();
    expect(runner.loaded).toEqual(["return cube(10);"]);
  });

  test("repairs once, forwarding the prior code + error + attempt", async () => {
    const { fn, calls } = fakeGenerate(["broken", "fixed"]);
    const runner = fakeRunner([
      { ok: false, error: "kernel boom" },
      { ok: true },
    ]);

    const result = await generateAndRun("a bracket", runner, { generate: fn });

    expect(result.status).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.opts.attempt).toBe(1);
    expect(calls[1]?.opts.previous).toEqual({
      code: "broken",
      error: "kernel boom",
    });
    expect(runner.loaded).toEqual(["broken", "fixed"]);
  });

  test("stops after MAX_REPAIR_ATTEMPTS, restores prior code, returns a generic error", async () => {
    const { fn, calls } = fakeGenerate(["bad1", "bad2", "bad3"]);
    const runner = fakeRunner([
      { ok: false, error: "e1" },
      { ok: false, error: "e2" },
      { ok: false, error: "e3" },
    ]);

    const result = await generateAndRun("hard part", runner, { generate: fn });

    expect(result.status).toBe("error");
    expect(result).toMatchObject({
      message: expect.stringMatching(/try rephrasing/i),
    });
    // Initial + 2 repairs = 3 generate calls, attempts 1 and 2
    expect(calls).toHaveLength(1 + MAX_REPAIR_ATTEMPTS);
    expect(calls[1]?.opts.attempt).toBe(1);
    expect(calls[2]?.opts.attempt).toBe(2);
    // Last load restores the user's prior working code
    expect(runner.loaded[runner.loaded.length - 1]).toBe("return cube(1);");
  });

  test("surfaces the gateway's generic message when generate throws", async () => {
    const runner = fakeRunner([{ ok: true }]);
    const generate = () =>
      Promise.reject(
        new GenerateError(
          "Too many requests. Please slow down and try again.",
          429,
        ),
      );

    const result = await generateAndRun("a cube", runner, { generate });

    expect(result).toEqual({
      status: "error",
      message: "Too many requests. Please slow down and try again.",
    });
  });

  test("never leaks a non-GenerateError detail", async () => {
    const runner = fakeRunner([{ ok: true }]);
    const generate = () =>
      Promise.reject(new Error("TypeError: undefined at line 42"));

    const result = await generateAndRun("a cube", runner, { generate });

    expect(result.status).toBe("error");
    expect((result as { message: string }).message).not.toMatch(
      /TypeError|line 42/,
    );
  });

  test("forwards byokKey to every generate call", async () => {
    const { fn, calls } = fakeGenerate(["broken", "fixed"]);
    const runner = fakeRunner([{ ok: false, error: "boom" }, { ok: true }]);

    await generateAndRun("a cube", runner, {
      generate: fn,
      byokKey: "sk-user",
    });

    expect(calls[0]?.opts.byokKey).toBe("sk-user");
    expect(calls[1]?.opts.byokKey).toBe("sk-user");
  });
});
