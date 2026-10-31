import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { GenerateError, generateModel } from "./generate";

const API_URL = "https://facet-api.test";

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** Replace global fetch with a stub that records the last call and returns `response`. */
function stubFetch(response: Response): () => FetchCall {
  let last: FetchCall | undefined;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    last = { url: String(input), init: init ?? {} };
    return Promise.resolve(response);
  }) as typeof fetch;
  return () => {
    if (!last) throw new Error("fetch was not called");
    return last;
  };
}

const ok = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const err = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

const originalFetch = globalThis.fetch;

// A managed call needs a bearer token. Inject a stub so these tests exercise
// the request instead of short-circuiting on a missing identity
const TOKEN = "omni-access-token";
const managed = { getAccessToken: async () => TOKEN };

const authHeader = (call: FetchCall): string | undefined =>
  (call.init.headers as Record<string, string>).authorization;

describe("generateModel", () => {
  beforeEach(() => {
    process.env.VITE_FACET_API_URL = API_URL;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.VITE_FACET_API_URL = undefined;
    delete process.env.VITE_FACET_API_URL;
  });

  test("POSTs JSON to the gateway /generate with the prompt", async () => {
    const lastCall = stubFetch(
      ok({ code: "return cube(10);", usage: { credits: 2, costCents: 1.3 } }),
    );

    const result = await generateModel("a 10mm cube", managed);

    const call = lastCall();
    expect(call.url).toBe(`${API_URL}/generate`);
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    const body = JSON.parse(call.init.body as string);
    expect(body).toEqual({ prompt: "a 10mm cube" });
    expect(result.code).toBe("return cube(10);");
    expect(result.usage).toEqual({ credits: 2, costCents: 1.3 });
  });

  test("attaches a Bearer token on the managed path", async () => {
    const lastCall = stubFetch(
      ok({ code: "x", usage: { credits: 1, costCents: 1 } }),
    );

    await generateModel("a part", managed);

    expect(authHeader(lastCall())).toBe(`Bearer ${TOKEN}`);
  });

  test("does not call the gateway without a token, signalling sign-in", async () => {
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      return Promise.resolve(
        ok({ code: "x", usage: { credits: 0, costCents: 0 } }),
      );
    }) as unknown as typeof fetch;

    try {
      await generateModel("a part", { getAccessToken: async () => null });
      throw new Error("expected generateModel to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(GenerateError);
      expect((e as GenerateError).status).toBe(401);
    }
    expect(called).toBe(false);
  });

  test("a BYOK call sends no Authorization header and stays anonymous", async () => {
    const lastCall = stubFetch(
      ok({ code: "x", usage: { credits: 0, costCents: 0 } }),
    );

    // A token getter that would throw if consulted proves BYOK never resolves one
    await generateModel("a gear", {
      byokKey: "sk-user-key",
      getAccessToken: async () => {
        throw new Error("BYOK must not resolve a token");
      },
    });

    const call = lastCall();
    expect(authHeader(call)).toBeUndefined();
    expect(JSON.parse(call.init.body as string).byokKey).toBe("sk-user-key");
  });

  test("strips a trailing slash from the base URL", async () => {
    process.env.VITE_FACET_API_URL = `${API_URL}/`;
    const lastCall = stubFetch(
      ok({ code: "x", usage: { credits: 1, costCents: 1 } }),
    );

    await generateModel("hi", managed);

    expect(lastCall().url).toBe(`${API_URL}/generate`);
  });

  test("forwards previous + attempt on a repair call", async () => {
    const lastCall = stubFetch(
      ok({ code: "fixed", usage: { credits: 1, costCents: 1 } }),
    );

    await generateModel("a bracket", {
      ...managed,
      previous: { code: "broken", error: "boom" },
      attempt: 1,
    });

    const body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({
      prompt: "a bracket",
      previous: { code: "broken", error: "boom" },
      attempt: 1,
    });
  });

  test("throws a clear error when the gateway URL is unset", async () => {
    delete process.env.VITE_FACET_API_URL;
    stubFetch(ok({ code: "x", usage: { credits: 0, costCents: 0 } }));

    await expect(generateModel("anything")).rejects.toThrow(/not configured/i);
  });

  const statuses: Array<[number, string]> = [
    [400, "Prompt is missing or too long."],
    [429, "Too many requests. Please slow down and try again."],
    [422, "Could not generate valid code. Try rephrasing your request."],
    [502, "AI generation failed. Please try again."],
    [503, "AI generation is temporarily unavailable."],
  ];

  for (const [status, message] of statuses) {
    test(`surfaces the server's generic message on ${status}`, async () => {
      stubFetch(err(status, { error: message }));

      try {
        await generateModel("a part", managed);
        throw new Error("expected generateModel to throw");
      } catch (e) {
        expect(e).toBeInstanceOf(GenerateError);
        const ge = e as GenerateError;
        expect(ge.message).toBe(message);
        expect(ge.status).toBe(status);
      }
    });
  }

  test("does not invent detail when the error body has no message", async () => {
    stubFetch(err(500, {}));

    try {
      await generateModel("a part", managed);
      throw new Error("expected generateModel to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(GenerateError);
      // A generic fallback, never a leaked internal detail
      expect((e as GenerateError).message).toMatch(/failed/i);
    }
  });

  test("surfaces a generic error on a network failure", async () => {
    globalThis.fetch = (() =>
      Promise.reject(
        new Error("ECONNREFUSED at 10.0.0.1"),
      )) as unknown as typeof fetch;

    try {
      await generateModel("a part", managed);
      throw new Error("expected generateModel to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(GenerateError);
      // The transport error detail must never reach the caller
      expect((e as GenerateError).message).not.toMatch(
        /ECONNREFUSED|10\.0\.0\.1/,
      );
    }
  });
});
