import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { setAiTrainingConsent } from "./consent";

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

const consentResponse = (consent: boolean) =>
  new Response(JSON.stringify({ consent }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const originalFetch = globalThis.fetch;
const managed = { getAccessToken: async () => "omni-access-token" };

describe("setAiTrainingConsent", () => {
  beforeEach(() => {
    process.env.VITE_FACET_API_URL = API_URL;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.VITE_FACET_API_URL;
  });

  test("POSTs the consent value with the bearer token and returns the persisted state", async () => {
    const lastCall = stubFetch(consentResponse(true));

    const result = await setAiTrainingConsent(true, managed);

    expect(result).toBe(true);
    const call = lastCall();
    expect(call?.url).toBe(`${API_URL}/consent`);
    expect(call?.init.method).toBe("POST");
    expect(JSON.parse(call?.init.body as string)).toEqual({ consent: true });
    expect(new Headers(call?.init.headers).get("authorization")).toBe(
      "Bearer omni-access-token",
    );
  });

  test("returns the gateway's state, the source of truth even if it differs", async () => {
    stubFetch(consentResponse(false));

    expect(await setAiTrainingConsent(true, managed)).toBe(false);
  });

  test("throws on a non-success so the caller can revert the optimistic toggle", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("nope", { status: 500 }),
      )) as unknown as typeof fetch;

    await expect(setAiTrainingConsent(true, managed)).rejects.toThrow();
  });
});
