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

  test("parses the pooled credit balance and tier when present", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          signedIn: true,
          managedGeneration: true,
          tier: "pro",
          credits: { balance: 1234 },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const caps = await fetchCapabilities(async () => "tok");
    expect(caps).toEqual({
      signedIn: true,
      managedGeneration: true,
      tier: "pro",
      credits: { balance: 1234 },
    });
  });

  test("parses the AI training-data consent flag when present", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          signedIn: true,
          managedGeneration: true,
          aiTrainingConsent: true,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const caps = await fetchCapabilities(async () => "tok");
    expect(caps.aiTrainingConsent).toBe(true);
    expect(caps.managedGeneration).toBe(true);
  });

  test("parses the personal workspace slug, lowercased", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          signedIn: true,
          managedGeneration: true,
          tier: "free",
          workspace: { slug: "Ada-Lovelace" },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const caps = await fetchCapabilities(async () => "tok");
    expect(caps.workspace).toEqual({ slug: "ada-lovelace" });
  });

  test("omits a missing or malformed workspace (older gateway)", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    for (const workspace of [
      undefined,
      null,
      "ada",
      { slug: 42 },
      { slug: "" },
      { slug: "not a slug" },
      { slug: "../billing" },
    ]) {
      global.fetch = (async () =>
        new Response(
          JSON.stringify({
            signedIn: true,
            managedGeneration: true,
            workspace,
          }),
          { status: 200 },
        )) as unknown as typeof fetch;

      const caps = await fetchCapabilities(async () => "tok");
      expect(caps.workspace).toBeUndefined();
      expect(caps.managedGeneration).toBe(true);
    }
  });

  test("reports a session that must sign in again", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          signedIn: true,
          managedGeneration: false,
          reauthRequired: true,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const caps = await fetchCapabilities(async () => "tok");
    expect(caps).toEqual({
      signedIn: true,
      managedGeneration: false,
      reauthRequired: true,
    });
  });

  test("only a literal true asks for a new sign-in", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          signedIn: true,
          managedGeneration: true,
          reauthRequired: "yes",
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const caps = await fetchCapabilities(async () => "tok");
    expect(caps.reauthRequired).toBeUndefined();
  });

  test("reports a signed-in user who must pay before managed generation", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          signedIn: true,
          managedGeneration: false,
          paymentRequired: true,
          tier: "free",
          workspace: { slug: "ada" },
          credits: { balance: 0 },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const caps = await fetchCapabilities(async () => "tok");
    expect(caps).toEqual({
      signedIn: true,
      managedGeneration: false,
      paymentRequired: true,
      tier: "free",
      workspace: { slug: "ada" },
      credits: { balance: 0 },
    });
  });

  test("reads the card offer only on a payment-required answer", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    const answer = (body: Record<string, unknown>) => {
      global.fetch = (async () =>
        new Response(JSON.stringify(body), {
          status: 200,
        })) as unknown as typeof fetch;
    };

    answer({
      signedIn: true,
      managedGeneration: false,
      paymentRequired: true,
      cardOffer: { monthlyCredits: 50 },
    });
    expect((await fetchCapabilities(async () => "tok")).cardOffer).toEqual({
      monthlyCredits: 50,
    });

    for (const cardOffer of [
      null,
      { monthlyCredits: "50" },
      { monthlyCredits: 0 },
      { monthlyCredits: 2.5 },
    ]) {
      answer({
        signedIn: true,
        managedGeneration: false,
        paymentRequired: true,
        cardOffer,
      });
      expect(
        (await fetchCapabilities(async () => "tok")).cardOffer,
      ).toBeUndefined();
    }

    answer({
      signedIn: true,
      managedGeneration: true,
      cardOffer: { monthlyCredits: 50 },
    });
    expect(
      (await fetchCapabilities(async () => "tok")).cardOffer,
    ).toBeUndefined();
  });

  test("omits paymentRequired from an older gateway or a non-boolean value", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    for (const paymentRequired of [undefined, "yes", 1, false]) {
      global.fetch = (async () =>
        new Response(
          JSON.stringify({
            signedIn: true,
            managedGeneration: false,
            paymentRequired,
          }),
          { status: 200 },
        )) as unknown as typeof fetch;

      const caps = await fetchCapabilities(async () => "tok");
      expect(caps.paymentRequired).toBeUndefined();
    }
  });

  test("ignores the retired monthly-cap shape", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          signedIn: true,
          managedGeneration: true,
          credits: { used: 10, cap: 100, remaining: 90 },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const caps = await fetchCapabilities(async () => "tok");
    expect(caps.credits).toBeUndefined();
    expect(caps.managedGeneration).toBe(true);
  });

  test("omits a malformed or partial balance rather than showing a broken one", async () => {
    process.env.VITE_FACET_API_URL = API_URL;
    global.fetch = (async () =>
      new Response(
        // a non-numeric balance is not a usable figure
        JSON.stringify({
          signedIn: true,
          managedGeneration: true,
          credits: { balance: "lots" },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const caps = await fetchCapabilities(async () => "tok");
    expect(caps.credits).toBeUndefined();
    expect(caps.managedGeneration).toBe(true);
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
