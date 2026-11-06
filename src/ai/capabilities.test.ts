import { afterEach, describe, expect, test } from "bun:test";

import { fetchCapabilities } from "./capabilities";

const API_URL = "https://api.facet.test";
const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  process.env.VITE_FACET_API_URL = undefined;
  delete process.env.VITE_FACET_API_URL;
});

describe("fetchCapabilities", () => {
  test("returns no capability when the gateway URL is unset", async () => {
    delete process.env.VITE_FACET_API_URL;
    expect(await fetchCapabilities(async () => "token")).toEqual({
      signedIn: false,
      managedGeneration: false,
    });
  });

  test("sends the bearer token and returns the gateway's answer", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    const seen: { url: string; auth: string | null } = { url: "", auth: null };
    global.fetch = (async (url: string, init?: RequestInit) => {
      seen.url = url;
      seen.auth = new Headers(init?.headers).get("authorization");
      return new Response(
        JSON.stringify({ signedIn: true, managedGeneration: true }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const caps = await fetchCapabilities(async () => "tok-123");
    expect(seen.url).toBe(`${API_URL}/capabilities`);
    expect(seen.auth).toBe("Bearer tok-123");
    expect(caps).toEqual({ signedIn: true, managedGeneration: true });
  });

  test("omits the auth header when there is no token", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    const seen: { auth: string | null } = { auth: "unset" };
    global.fetch = (async (_url: string, init?: RequestInit) => {
      seen.auth = new Headers(init?.headers).get("authorization");
      return new Response(
        JSON.stringify({ signedIn: false, managedGeneration: false }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await fetchCapabilities(async () => null);
    expect(seen.auth).toBeNull();
  });

  test("fails closed on a non-ok response", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    global.fetch = (async () =>
      new Response("nope", { status: 500 })) as unknown as typeof fetch;
    expect(await fetchCapabilities(async () => "tok")).toEqual({
      signedIn: false,
      managedGeneration: false,
    });
  });

  test("fails closed when fetch throws", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    global.fetch = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await fetchCapabilities(async () => "tok")).toEqual({
      signedIn: false,
      managedGeneration: false,
    });
  });
});
