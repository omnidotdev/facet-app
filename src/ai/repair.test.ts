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
    return Promise.resolve({ code: code ?? "" });
  };
  return { fn, calls };
}

describe("generateAndRun", () => {
  test("generates, runs once, and reports success", async () => {
    const { fn, calls } = fakeGenerate(["return cube(10);"]);
    const runner = fakeRunner([{ ok: true }]);

    const result = await generateAndRun("a cube", runner, { generate: fn });

    // no credit figure: spend comes from the balance change, never local math
    expect(result).toEqual({ status: "ok", repairs: 0 });
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
    expect(result).toMatchObject({ repairs: 1 });
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
      repairs: MAX_REPAIR_ATTEMPTS,
    });
    // Initial + 2 repairs = 3 generate calls, attempts 1 and 2
    expect(calls).toHaveLength(1 + MAX_REPAIR_ATTEMPTS);
    expect(calls[1]?.opts.attempt).toBe(1);
    expect(calls[2]?.opts.attempt).toBe(2);
    // Last load restores the user's prior working code
    expect(runner.loaded[runner.loaded.length - 1]).toBe("return cube(1);");
  });

  test("does not restore prior code on failure when generating into a fresh tab", async () => {
    const { fn } = fakeGenerate(["bad1", "bad2", "bad3"]);
    const runner = fakeRunner([
      { ok: false, error: "e1" },
      { ok: false, error: "e2" },
      { ok: false, error: "e3" },
    ]);

    const result = await generateAndRun("hard part", runner, {
      generate: fn,
      restorePriorOnFailure: false,
    });

    expect(result.status).toBe("error");
    // The prior ("return cube(1);") is never loaded back; the last attempt stays
    expect(runner.loaded).toEqual(["bad1", "bad2", "bad3"]);
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
      httpStatus: 429,
    });
  });

  test("propagates the gateway status so the caller can react to 401/402", async () => {
    const runner = fakeRunner([{ ok: true }]);
    const generate = () =>
      Promise.reject(new GenerateError("Sign in to generate.", 401));

    const result = await generateAndRun("a cube", runner, { generate });

    expect(result).toEqual({
      status: "error",
      message: "Sign in to generate.",
      httpStatus: 401,
    });
  });

  test("propagates the gateway's stable error code", async () => {
    const runner = fakeRunner([{ ok: true }]);
    const generate = () =>
      Promise.reject(
        new GenerateError(
          "Generation uses AI credits.",
          402,
          "payment_required",
        ),
      );

    const result = await generateAndRun("a cube", runner, { generate });

    expect(result).toEqual({
      status: "error",
      message: "Generation uses AI credits.",
      httpStatus: 402,
      errorCode: "payment_required",
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

  test("forwards refine on the initial generate call (a critic-driven pass)", async () => {
    const { fn, calls } = fakeGenerate(["return better();"]);
    const runner = fakeRunner([{ ok: true }]);

    await generateAndRun("scorpio symbol", runner, {
      generate: fn,
      refine: { code: "return cube(10);", suggestion: "add a curved tail" },
    });

    expect(calls[0]?.opts.refine).toEqual({
      code: "return cube(10);",
      suggestion: "add a curved tail",
    });
  });

  test("a kernel-error repair during a refine pass drops refine for previous", async () => {
    // Once the refined code throws, the active concern is the error: the repair
    // call carries `previous` (code + error), never the stale refine suggestion
    const { fn, calls } = fakeGenerate(["broken", "fixed"]);
    const runner = fakeRunner([{ ok: false, error: "boom" }, { ok: true }]);

    await generateAndRun("scorpio symbol", runner, {
      generate: fn,
      refine: { code: "return cube(10);", suggestion: "add a curved tail" },
    });

    expect(calls[1]?.opts.refine).toBeUndefined();
    expect(calls[1]?.opts.previous).toEqual({ code: "broken", error: "boom" });
  });

  test("forwards edit on the first call and on every repair", async () => {
    const { fn, calls } = fakeGenerate(["broken", "fixed"]);
    const runner = fakeRunner([{ ok: false, error: "boom" }, { ok: true }]);
    const edit = { code: "return cube(10);" };

    await generateAndRun("make it taller", runner, { generate: fn, edit });

    expect(calls[0]?.opts.edit).toEqual(edit);
    expect(calls[1]?.opts.edit).toEqual(edit);
    expect(calls[1]?.opts.previous).toEqual({ code: "broken", error: "boom" });
  });

  test("an edit that never runs keeps the open model and says the change failed", async () => {
    const { fn } = fakeGenerate(["broken"]);
    const runner = fakeRunner(
      [{ ok: false, error: "boom" }],
      "return cube(10);",
    );

    const result = await generateAndRun("make it taller", runner, {
      generate: fn,
      edit: { code: "return cube(10);" },
    });

    expect(result).toMatchObject({
      status: "error",
      message: "Could not make that change. Try rephrasing your request.",
    });
    expect(runner.loaded.at(-1)).toBe("return cube(10);");
  });

  test("captures the gateway's generationId and returns it", async () => {
    const calls: Array<{ opts: GenerateOptions }> = [];
    const fn = (_p: string, opts: GenerateOptions = {}) => {
      calls.push({ opts });
      return Promise.resolve({
        code: "return cube(10);",
        generationId: "gen-1",
      });
    };
    const runner = fakeRunner([{ ok: true }]);

    const result = await generateAndRun("a cube", runner, { generate: fn });

    expect(result).toMatchObject({ status: "ok", generationId: "gen-1" });
  });

  test("threads the captured generationId onto a repair re-entry", async () => {
    const calls: Array<{ opts: GenerateOptions }> = [];
    const codes = ["broken", "fixed"];
    let i = 0;
    const fn = (_p: string, opts: GenerateOptions = {}) => {
      calls.push({ opts });
      const code = codes[Math.min(i, codes.length - 1)] ?? "";
      i += 1;
      // only the first call mints the id; the re-entry must carry it back
      return Promise.resolve(
        i === 1 ? { code, generationId: "gen-1" } : { code },
      );
    };
    const runner = fakeRunner([{ ok: false, error: "boom" }, { ok: true }]);

    const result = await generateAndRun("a bracket", runner, { generate: fn });

    expect(result).toMatchObject({ status: "ok", generationId: "gen-1" });
    expect(calls[0]?.opts.generationId).toBeUndefined();
    expect(calls[1]?.opts.generationId).toBe("gen-1");
  });

  test("forwards a caller-supplied generationId on the first call (refine re-entry)", async () => {
    const { fn, calls } = fakeGenerate(["return better();"]);
    const runner = fakeRunner([{ ok: true }]);

    await generateAndRun("scorpio symbol", runner, {
      generate: fn,
      generationId: "gen-from-panel",
      refine: { code: "return cube(10);", suggestion: "add a tail" },
    });

    expect(calls[0]?.opts.generationId).toBe("gen-from-panel");
  });

  describe("an initial result from a background job", () => {
    test("runs the job's code without calling the gateway", async () => {
      const { fn, calls } = fakeGenerate(["unused"]);
      const runner = fakeRunner([{ ok: true }]);

      const result = await generateAndRun("a cube", runner, {
        generate: fn,
        initial: { code: "return cube(10);", generationId: "gen-job" },
      });

      expect(calls).toHaveLength(0);
      expect(runner.loaded).toEqual(["return cube(10);"]);
      expect(result).toEqual({
        status: "ok",
        repairs: 0,
        generationId: "gen-job",
      });
    });

    test("repairs a kernel error in the job's code, continuing its chain", async () => {
      const { fn, calls } = fakeGenerate(["return fixed();"]);
      const runner = fakeRunner([{ ok: false, error: "boom" }, { ok: true }]);

      const result = await generateAndRun("a cube", runner, {
        generate: fn,
        initial: { code: "return broken();", generationId: "gen-job" },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.opts).toMatchObject({
        previous: { code: "return broken();", error: "boom" },
        attempt: 1,
        generationId: "gen-job",
      });
      expect(result).toMatchObject({ status: "ok", repairs: 1 });
    });

    test("a failed repair reports the repairs made after the job's draft", async () => {
      const { fn } = fakeGenerate(["return still();"]);
      const runner = fakeRunner([{ ok: false, error: "boom" }]);

      const result = await generateAndRun("a cube", runner, {
        generate: fn,
        initial: { code: "return broken();" },
        maxAttempts: 1,
        restorePriorOnFailure: false,
      });

      expect(result).toMatchObject({ status: "error", repairs: 1 });
    });
  });
});
