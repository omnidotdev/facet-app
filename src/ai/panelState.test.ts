import { describe, expect, test } from "bun:test";

import {
  billingHubUrl,
  classifyGenerateError,
  resolvePanelMode,
} from "./panelState";

describe("resolvePanelMode", () => {
  test("signed in generates regardless of key or auth config", () => {
    expect(
      resolvePanelMode({
        authConfigured: true,
        signedIn: true,
        hasByok: false,
      }),
    ).toBe("generate");
    expect(
      resolvePanelMode({
        authConfigured: false,
        signedIn: true,
        hasByok: false,
      }),
    ).toBe("generate");
  });

  test("a BYOK key generates even when signed out", () => {
    expect(
      resolvePanelMode({
        authConfigured: true,
        signedIn: false,
        hasByok: true,
      }),
    ).toBe("generate");
    expect(
      resolvePanelMode({
        authConfigured: false,
        signedIn: false,
        hasByok: true,
      }),
    ).toBe("generate");
  });

  test("signed out with no key offers sign-in when auth is configured", () => {
    expect(
      resolvePanelMode({
        authConfigured: true,
        signedIn: false,
        hasByok: false,
      }),
    ).toBe("signIn");
  });

  test("signed out with no key and no auth falls back to BYOK-only", () => {
    expect(
      resolvePanelMode({
        authConfigured: false,
        signedIn: false,
        hasByok: false,
      }),
    ).toBe("needsKey");
  });
});

describe("classifyGenerateError", () => {
  test("401 asks the user to sign in", () => {
    expect(classifyGenerateError(401)).toBe("signIn");
  });

  test("402 reports being out of credits", () => {
    expect(classifyGenerateError(402)).toBe("outOfCredits");
  });

  test("other statuses are generic", () => {
    for (const status of [undefined, 400, 422, 429, 500, 502, 503]) {
      expect(classifyGenerateError(status)).toBe("generic");
    }
  });
});

describe("billingHubUrl", () => {
  test("a 402 funnels to the account hub's Facet billing page", () => {
    // 402 is the out-of-credits status the panel surfaces the upgrade CTA for
    expect(classifyGenerateError(402)).toBe("outOfCredits");
    expect(billingHubUrl("https://account.omni.dev")).toBe(
      "https://account.omni.dev/billing?product=facet",
    );
  });

  test("trims a trailing slash before appending the billing path", () => {
    expect(billingHubUrl("https://account.omni.dev/")).toBe(
      "https://account.omni.dev/billing?product=facet",
    );
  });

  test("returns null when no account hub is configured", () => {
    expect(billingHubUrl(undefined)).toBeNull();
    expect(billingHubUrl("")).toBeNull();
    expect(billingHubUrl("   ")).toBeNull();
  });
});
