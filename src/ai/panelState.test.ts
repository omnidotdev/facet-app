import { describe, expect, test } from "bun:test";

import {
  PANEL_COPY,
  SYNAPSE_KEY_URL,
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

describe("BYOK is framed as a Synapse key", () => {
  // The gateway forwards the BYOK key to the Synapse router with a
  // provider-prefixed model id, so a raw provider key cannot work. These lock
  // the correct framing and guard against regressing to "provider key"

  test("the key-minting link points at the Synapse dashboard", () => {
    expect(SYNAPSE_KEY_URL).toBe("https://synapse.omni.dev");
  });

  test("every BYOK-facing string says Synapse, never 'provider'", () => {
    const strings = Object.values(PANEL_COPY);
    expect(strings.length).toBeGreaterThan(0);
    for (const copy of strings) {
      expect(copy.toLowerCase()).not.toContain("provider");
    }
    expect(PANEL_COPY.byokToggle).toContain("Synapse");
    expect(PANEL_COPY.byokPlaceholder).toContain("Synapse");
  });

  test("the credit-path prompts offer BYOK as the escape hatch", () => {
    expect(PANEL_COPY.signInPrompt).toContain("Synapse key");
    expect(PANEL_COPY.outOfCredits).toContain("Synapse key");
  });
});
