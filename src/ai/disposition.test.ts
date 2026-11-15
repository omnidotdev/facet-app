import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { reportDisposition } from "./disposition";

const API_URL = "https://facet-api.test";

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** Replace global fetch with a stub that records the last call and returns `response`. */
function stubFetch(response: Response): () => FetchCall | undefined {
  let last: FetchCall | undefined;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    last = { url: String(input), init: init ?? {} };
    return Promise.resolve(response);
  }) as typeof fetch;
  return () => last;
}

const ok = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const originalFetch = globalThis.fetch;
const TOKEN = "omni-access-token";
const managed = { getAccessToken: async () => TOKEN };

describe("reportDisposition", () => {
  beforeEach(() => {
    process.env.VITE_FACET_API_URL = API_URL;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.VITE_FACET_API_URL;
  });

  test("POSTs the generation id and disposition, returning true", async () => {
    const lastCall = stubFetch(ok());

    const sent = await reportDisposition("gen-1", "kept", managed);

    expect(sent).toBe(true);
    const call = lastCall();
    expect(call?.url).toBe(`${API_URL}/disposition`);
    expect(call?.init.method).toBe("POST");
    expect(JSON.parse(call?.init.body as string)).toEqual({
      generationId: "gen-1",
      disposition: "kept",
    });
  });

  test("does nothing and returns false when no generation id is known", async () => {
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      return Promise.resolve(ok());
    }) as unknown as typeof fetch;

    const sent = await reportDisposition(undefined, "kept", managed);

    expect(sent).toBe(false);
    expect(called).toBe(false);
  });

  test("swallows a failure and returns false (telemetry never breaks the UI)", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("network down"))) as unknown as typeof fetch;

    const sent = await reportDisposition("gen-2", "discarded", managed);

    expect(sent).toBe(false);
  });

  test("a BYOK report sends no Authorization header and stays anonymous", async () => {
    const lastCall = stubFetch(ok());

    await reportDisposition("gen-3", "kept", {
      byokKey: "sk-user-key",
      getAccessToken: async () => {
        throw new Error("BYOK must not resolve a token");
      },
    });

    const headers = lastCall()?.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });
});
