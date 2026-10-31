import { describe, expect, test } from "bun:test";

import { classifyGenerateError, resolvePanelMode } from "./panelState";

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
