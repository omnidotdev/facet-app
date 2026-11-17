import { describe, expect, mock, test } from "bun:test";

import {
  AUTH_SCOPE,
  REQUIRED_SCOPE,
  createScopedTokenStore,
  grantedScope,
  hasScope,
} from "./scope";

import type { KeyValueStore } from "@omnidotdev/providers/ai-client";

const TOKEN_KEY = "facet:auth-token:v1";
const TOKEN_URL = "https://identity.test/api/auth/oauth2/token";

/** An in-memory KeyValueStore */
const memoryStore = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed));
  const store: KeyValueStore = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  return { store, data };
};

const tokenResponse = (body: Record<string, unknown>) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
    })) as unknown as typeof fetch;

describe("scopes", () => {
  test("sign-in asks for the organization scope", () => {
    expect(AUTH_SCOPE.split(" ")).toEqual([
      "openid",
      "profile",
      "email",
      "organization",
    ]);
    expect(REQUIRED_SCOPE).toBe("organization");
  });

  test("hasScope matches whole space-separated scopes only", () => {
    expect(hasScope("openid organization", "organization")).toBe(true);
    expect(hasScope("openid organizations", "organization")).toBe(false);
    expect(hasScope("openid profile email", "organization")).toBe(false);
    expect(hasScope(undefined, "organization")).toBe(false);
  });

  test("grantedScope reads the token response, else the requested scope", () => {
    expect(grantedScope({ scope: "openid email" }, AUTH_SCOPE)).toBe(
      "openid email",
    );
    // An omitted scope means the requested one was granted (RFC 6749 5.1)
    expect(grantedScope({ access_token: "a" }, AUTH_SCOPE)).toBe(AUTH_SCOPE);
    expect(grantedScope(null, AUTH_SCOPE)).toBe(AUTH_SCOPE);
  });
});

describe("createScopedTokenStore", () => {
  test("records the granted scope with the stored token", async () => {
    const { store: base, data } = memoryStore();
    const scoped = createScopedTokenStore({
      store: base,
      tokenKey: TOKEN_KEY,
      requestedScope: AUTH_SCOPE,
      fetchImpl: tokenResponse({
        access_token: "tok",
        scope: "openid profile email organization",
      }),
    });

    const res = await scoped.fetchImpl(TOKEN_URL, { method: "POST" });
    // The caller can still read the body
    expect(((await res.json()) as { access_token: string }).access_token).toBe(
      "tok",
    );
    scoped.store.setItem(
      TOKEN_KEY,
      JSON.stringify({ accessToken: "tok", expiresAt: null }),
    );

    expect(JSON.parse(data.get(TOKEN_KEY) ?? "{}")).toEqual({
      accessToken: "tok",
      expiresAt: null,
      scope: "openid profile email organization",
    });
    expect(scoped.store.getItem(TOKEN_KEY)).not.toBeNull();
  });

  test("a token granted without the organization scope is not usable", async () => {
    const onStale = mock(() => {});
    const { store: base, data } = memoryStore();
    const scoped = createScopedTokenStore({
      store: base,
      tokenKey: TOKEN_KEY,
      requestedScope: AUTH_SCOPE,
      fetchImpl: tokenResponse({ access_token: "tok", scope: "openid email" }),
      onStale,
    });

    await scoped.fetchImpl(TOKEN_URL, { method: "POST" });
    scoped.store.setItem(
      TOKEN_KEY,
      JSON.stringify({ accessToken: "tok", expiresAt: null }),
    );

    expect(scoped.store.getItem(TOKEN_KEY)).toBeNull();
    expect(data.has(TOKEN_KEY)).toBe(false);
  });

  test("a legacy session with no recorded scope is dropped and flagged", async () => {
    const onStale = mock(() => {});
    const { store: base, data } = memoryStore({
      [TOKEN_KEY]: JSON.stringify({ accessToken: "old", expiresAt: null }),
    });
    const scoped = createScopedTokenStore({
      store: base,
      tokenKey: TOKEN_KEY,
      requestedScope: AUTH_SCOPE,
      onStale,
    });

    expect(scoped.store.getItem(TOKEN_KEY)).toBeNull();
    expect(data.has(TOKEN_KEY)).toBe(false);
    // Flagged once, deferred off the read path
    await Promise.resolve();
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(scoped.store.getItem(TOKEN_KEY)).toBeNull();
    await Promise.resolve();
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  test("other keys and non-token responses pass through untouched", async () => {
    const { store: base, data } = memoryStore();
    let calls = 0;
    const scoped = createScopedTokenStore({
      store: base,
      tokenKey: TOKEN_KEY,
      requestedScope: AUTH_SCOPE,
      fetchImpl: (async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });

    await scoped.fetchImpl("https://identity.test/oauth2/userinfo");
    expect(calls).toBe(1);
    scoped.store.setItem("other", "value");
    expect(data.get("other")).toBe("value");
    expect(scoped.store.getItem("other")).toBe("value");
    scoped.store.removeItem("other");
    expect(data.has("other")).toBe(false);
  });

  test("a malformed stored value is left for the session to reject", () => {
    const { store: base } = memoryStore({ [TOKEN_KEY]: "not json" });
    const scoped = createScopedTokenStore({
      store: base,
      tokenKey: TOKEN_KEY,
      requestedScope: AUTH_SCOPE,
    });
    expect(scoped.store.getItem(TOKEN_KEY)).toBeNull();
  });
});
