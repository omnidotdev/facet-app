import { describe, expect, test } from "bun:test";

import {
  BALANCE_CAPTION,
  PANEL_COPY,
  PROMPT_SUGGESTIONS,
  PROMPT_SUGGESTION_COUNT,
  SYNAPSE_KEY_URL,
  addCardLabel,
  billingHubUrl,
  canUpgrade,
  classifyGenerateError,
  createThrottle,
  creditsSpent,
  followUpAction,
  followUpNotice,
  formatBalance,
  formatGeneratedToast,
  formatPerPartEstimate,
  formatSpentNote,
  noticeLinks,
  phaseLabel,
  refreshedAccess,
  resolveManagedAccess,
  resolvePanelMode,
  shouldClearOutOfCredits,
  shouldClearPaymentRequired,
  stripProvenanceHeader,
  studioReturnUrl,
  upgradeUrl,
  withProvenanceHeader,
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

describe("resolvePanelMode in the paid-access state", () => {
  test("a user who must pay leads with the key path until a key is set", () => {
    expect(
      resolvePanelMode({
        authConfigured: true,
        signedIn: true,
        hasByok: false,
        paymentRequired: true,
      }),
    ).toBe("needsKey");
  });

  test("their own key lets them generate", () => {
    expect(
      resolvePanelMode({
        authConfigured: true,
        signedIn: true,
        hasByok: true,
        paymentRequired: true,
      }),
    ).toBe("generate");
  });
});

describe("resolveManagedAccess", () => {
  test("managed generation wins", () => {
    expect(
      resolveManagedAccess({ signedIn: true, managedGeneration: true }),
    ).toBe("managed");
    expect(
      resolveManagedAccess({
        signedIn: true,
        managedGeneration: true,
        paymentRequired: true,
      }),
    ).toBe("managed");
  });

  test("a signed-in user who is not yet a customer must pay", () => {
    expect(
      resolveManagedAccess({
        signedIn: true,
        managedGeneration: false,
        paymentRequired: true,
      }),
    ).toBe("paymentRequired");
  });

  test("anything else has no managed access", () => {
    expect(
      resolveManagedAccess({ signedIn: true, managedGeneration: false }),
    ).toBe("none");
    expect(
      resolveManagedAccess({
        signedIn: false,
        managedGeneration: false,
        paymentRequired: true,
      }),
    ).toBe("none");
  });
});

describe("refreshedAccess", () => {
  test("a purchase that lands switches the panel to managed", () => {
    expect(
      refreshedAccess("paymentRequired", {
        signedIn: true,
        managedGeneration: true,
      }),
    ).toBe("managed");
  });

  test("a stale managed state settles on paid access", () => {
    expect(
      refreshedAccess("managed", {
        signedIn: true,
        managedGeneration: false,
        paymentRequired: true,
      }),
    ).toBe("paymentRequired");
  });

  test("a failed read keeps what is shown", () => {
    expect(
      refreshedAccess("paymentRequired", {
        signedIn: false,
        managedGeneration: false,
      }),
    ).toBe("paymentRequired");
    expect(
      refreshedAccess("managed", { signedIn: false, managedGeneration: false }),
    ).toBe("managed");
  });
});

describe("classifyGenerateError", () => {
  test("401 asks the user to sign in", () => {
    expect(classifyGenerateError(401)).toBe("signIn");
  });

  test("402 reports being out of credits", () => {
    expect(classifyGenerateError(402)).toBe("outOfCredits");
  });

  test("402 with payment_required asks a non-customer to pay", () => {
    expect(classifyGenerateError(402, "payment_required")).toBe(
      "paymentRequired",
    );
  });

  test("402 with out_of_credits or no code stays out of credits", () => {
    expect(classifyGenerateError(402, "out_of_credits")).toBe("outOfCredits");
    expect(classifyGenerateError(402, undefined)).toBe("outOfCredits");
  });

  test("the payment code only matters on a 402", () => {
    expect(classifyGenerateError(500, "payment_required")).toBe("generic");
  });

  test("403 reports a plan that does not include the feature", () => {
    expect(classifyGenerateError(403)).toBe("planRequired");
  });

  test("429 reports a usage limit", () => {
    expect(classifyGenerateError(429)).toBe("usageLimit");
  });

  test("429 too_many_jobs is the queue cap, not a usage limit (no upgrade link)", () => {
    expect(classifyGenerateError(429, "too_many_jobs")).toBe("generic");
    expect(
      noticeLinks(classifyGenerateError(429, "too_many_jobs"), "free"),
    ).toEqual({
      buyCredits: false,
      upgrade: false,
    });
  });

  test("other statuses are generic", () => {
    for (const status of [undefined, 400, 422, 500, 502, 503]) {
      expect(classifyGenerateError(status)).toBe("generic");
    }
  });
});

describe("followUpAction", () => {
  test("surfaces billing refusals from a step after the draft", () => {
    expect(followUpAction(402)).toBe("outOfCredits");
    expect(followUpAction(403)).toBe("planRequired");
    expect(followUpAction(429)).toBe("usageLimit");
  });

  test("surfaces a payment refusal from a step after the draft", () => {
    expect(followUpAction(402, "payment_required")).toBe("paymentRequired");
  });

  test("stays silent on anything else, since the check is advisory", () => {
    for (const status of [undefined, 401, 400, 422, 500, 502, 503]) {
      expect(followUpAction(status)).toBeNull();
    }
  });
});

describe("followUpNotice", () => {
  test("out of credits says the draft is kept and to buy more", () => {
    const notice = followUpNotice("outOfCredits", "ignored");
    expect(notice).toMatch(/ready in the editor/i);
    expect(notice).toMatch(/buy more credits/i);
  });

  test("other refusals keep the gateway's message after the draft note", () => {
    expect(followUpNotice("usageLimit", "Usage limit reached.")).toBe(
      "Your part is ready in the editor. Usage limit reached.",
    );
    expect(followUpNotice("planRequired", "Upgrade to keep going.")).toBe(
      "Your part is ready in the editor. Upgrade to keep going.",
    );
  });
});

describe("canUpgrade", () => {
  test("only the free tier is offered an upgrade", () => {
    expect(canUpgrade("free")).toBe(true);
    expect(canUpgrade("pro")).toBe(false);
    expect(canUpgrade("team")).toBe(false);
    expect(canUpgrade(undefined)).toBe(false);
  });
});

describe("noticeLinks", () => {
  test("out of credits offers credits, plus an upgrade on the free tier", () => {
    expect(noticeLinks("outOfCredits", "free")).toEqual({
      buyCredits: true,
      upgrade: true,
    });
    expect(noticeLinks("outOfCredits", "pro")).toEqual({
      buyCredits: true,
      upgrade: false,
    });
  });

  test("a plan refusal offers an upgrade unless the tier is known paid", () => {
    expect(noticeLinks("planRequired", "free")).toEqual({
      buyCredits: false,
      upgrade: true,
    });
    expect(noticeLinks("planRequired", undefined)).toEqual({
      buyCredits: false,
      upgrade: true,
    });
    expect(noticeLinks("planRequired", "pro")).toEqual({
      buyCredits: false,
      upgrade: false,
    });
  });

  test("a usage limit offers an upgrade on the free tier only", () => {
    expect(noticeLinks("usageLimit", "free")).toEqual({
      buyCredits: false,
      upgrade: true,
    });
    expect(noticeLinks("usageLimit", "pro")).toEqual({
      buyCredits: false,
      upgrade: false,
    });
  });

  test("a payment refusal offers credits and an upgrade unless known paid", () => {
    expect(noticeLinks("paymentRequired", "free")).toEqual({
      buyCredits: true,
      upgrade: true,
    });
    expect(noticeLinks("paymentRequired", undefined)).toEqual({
      buyCredits: true,
      upgrade: true,
    });
    expect(noticeLinks("paymentRequired", "pro")).toEqual({
      buyCredits: true,
      upgrade: false,
    });
  });

  test("anything else offers no billing links", () => {
    for (const action of [null, "signIn", "generic"] as const) {
      expect(noticeLinks(action, "free")).toEqual({
        buyCredits: false,
        upgrade: false,
      });
    }
  });
});

describe("shouldClearOutOfCredits", () => {
  test("clears once the balance is positive again", () => {
    expect(shouldClearOutOfCredits("outOfCredits", 10)).toBe(true);
  });

  test("keeps the notice while the balance is still empty or unknown", () => {
    expect(shouldClearOutOfCredits("outOfCredits", 0)).toBe(false);
    expect(shouldClearOutOfCredits("outOfCredits", null)).toBe(false);
  });

  test("never clears a different notice", () => {
    expect(shouldClearOutOfCredits("usageLimit", 10)).toBe(false);
    expect(shouldClearOutOfCredits(null, 10)).toBe(false);
  });
});

describe("shouldClearPaymentRequired", () => {
  test("clears once managed generation is available", () => {
    expect(shouldClearPaymentRequired("paymentRequired", "managed")).toBe(true);
  });

  test("keeps the notice while the user still has to pay", () => {
    expect(
      shouldClearPaymentRequired("paymentRequired", "paymentRequired"),
    ).toBe(false);
  });

  test("never clears a different notice", () => {
    expect(shouldClearPaymentRequired("outOfCredits", "managed")).toBe(false);
    expect(shouldClearPaymentRequired(null, "managed")).toBe(false);
  });
});

describe("paid-access copy", () => {
  test("says AI uses AI credits, with no free allowance or internals", () => {
    expect(PANEL_COPY.paymentRequired).toMatch(/AI credits/);
    expect(PANEL_COPY.paymentRequired).not.toMatch(
      /free|month|organization|402|synapse/i,
    );
    expect(PANEL_COPY.buyCredits).toBe("Buy credits");
    expect(PANEL_COPY.upgrade).toBe("Upgrade to Pro");
    expect(PANEL_COPY.byokToggle).toBe("Use your own Synapse key");
  });
});

describe("createThrottle", () => {
  test("allows the first call, then one per interval", () => {
    let now = 1_000;
    const allow = createThrottle(10_000, () => now);
    expect(allow()).toBe(true);
    now += 5_000;
    expect(allow()).toBe(false);
    now += 5_000;
    expect(allow()).toBe(true);
    now += 1;
    expect(allow()).toBe(false);
  });
});

describe("out-of-credits copy", () => {
  test("tells the user to buy credits, with no monthly-cap or workspace framing", () => {
    expect(PANEL_COPY.outOfCredits).toMatch(/buy more credits/i);
    expect(PANEL_COPY.outOfCredits).not.toMatch(/month|workspace|upgrade/i);
    expect(PANEL_COPY.buyCredits).toBe("Buy credits");
  });
});

describe("billingHubUrl", () => {
  test("a 402 funnels to the credits section of the personal workspace", () => {
    // 402 is the out-of-credits status the panel surfaces the buy CTA for
    expect(classifyGenerateError(402)).toBe("outOfCredits");
    expect(billingHubUrl("https://account.omni.dev", "ada")).toBe(
      "https://account.omni.dev/billing?product=facet&tab=ai&workspace=ada",
    );
  });

  test("still opens the credits section when the workspace is unknown", () => {
    expect(billingHubUrl("https://account.omni.dev")).toBe(
      "https://account.omni.dev/billing?product=facet&tab=ai",
    );
  });

  test("trims a trailing slash before appending the billing path", () => {
    expect(billingHubUrl("https://account.omni.dev/", "ada")).toBe(
      "https://account.omni.dev/billing?product=facet&tab=ai&workspace=ada",
    );
  });

  test("returns null when no account hub is configured", () => {
    expect(billingHubUrl(undefined)).toBeNull();
    expect(billingHubUrl("")).toBeNull();
    expect(billingHubUrl("   ", "ada")).toBeNull();
  });
});

describe("upgradeUrl", () => {
  test("opens Facet Pro checkout on the workspace and returns to the Studio", () => {
    expect(
      upgradeUrl("https://account.omni.dev", {
        workspaceSlug: "ada",
        returnUrl: "https://facet.omni.dev/studio",
      }),
    ).toBe(
      "https://account.omni.dev/billing?product=facet&plan=pro&interval=month&workspace=ada&return=https%3A%2F%2Ffacet.omni.dev%2Fstudio",
    );
  });

  test("omits the workspace and return when unknown, so the hub asks", () => {
    expect(upgradeUrl("https://account.omni.dev/", {})).toBe(
      "https://account.omni.dev/billing?product=facet&plan=pro&interval=month",
    );
  });

  test("returns null when no account hub is configured", () => {
    expect(upgradeUrl(undefined, { workspaceSlug: "ada" })).toBeNull();
    expect(upgradeUrl(" ", {})).toBeNull();
  });

  test("the call to action reads as an upgrade to Pro", () => {
    expect(PANEL_COPY.upgrade).toBe("Upgrade to Pro");
  });
});

describe("studioReturnUrl", () => {
  test("is the Studio on the current origin, lowercased", () => {
    expect(studioReturnUrl("https://Facet.Omni.dev")).toBe(
      "https://facet.omni.dev/studio",
    );
  });

  test("is undefined without a usable http(s) origin (e.g. a desktop shell)", () => {
    expect(studioReturnUrl(undefined)).toBeUndefined();
    expect(studioReturnUrl("null")).toBeUndefined();
    expect(studioReturnUrl("tauri://localhost")).toBeUndefined();
  });
});

describe("formatGeneratedToast", () => {
  test("managed shows the credits the balance went down by", () => {
    expect(formatGeneratedToast(3, false)).toBe("Generated (3 credits)");
  });

  test("a single credit is not pluralized", () => {
    expect(formatGeneratedToast(1, false)).toBe("Generated (1 credit)");
  });

  test("large figures are locale-grouped", () => {
    expect(formatGeneratedToast(1234, false)).toBe("Generated (1,234 credits)");
  });

  test("carries no middot separator", () => {
    expect(formatGeneratedToast(3, false)).not.toContain("·");
  });

  test("an unknown or unchanged balance shows no credit figure", () => {
    expect(formatGeneratedToast(null, false)).toBe("Generated");
    expect(formatGeneratedToast(0, false)).toBe("Generated");
  });

  test("the internal repair loop is never surfaced to the user", () => {
    // "repair" is an implementation detail with no user model; show cost only
    expect(formatGeneratedToast(9, false)).not.toContain("repair");
  });

  test("BYOK never shows a credit count (billed to the caller)", () => {
    expect(formatGeneratedToast(null, true)).toBe(
      "Generated with your Synapse key",
    );
    expect(formatGeneratedToast(5, true)).not.toContain("credit");
  });
});

describe("creditsSpent", () => {
  test("is the drop in the pooled balance across a generation", () => {
    expect(creditsSpent(120, 112)).toBe(8);
  });

  test("is null when either balance is unknown", () => {
    expect(creditsSpent(null, 112)).toBeNull();
    expect(creditsSpent(120, null)).toBeNull();
  });

  test("is null when the balance did not go down (e.g. a top-up landed)", () => {
    expect(creditsSpent(120, 120)).toBeNull();
    expect(creditsSpent(120, 500)).toBeNull();
  });
});

describe("formatBalance", () => {
  test("shows whole credits as a bare figure, with no separator", () => {
    expect(formatBalance(1234)).toBe("1,234 AI credits");
    expect(formatBalance(1)).toBe("1 AI credit");
    expect(formatBalance(0)).toBe("0 AI credits");
    expect(formatBalance(1234)).not.toContain("·");
  });

  test("the shared-pool context is a separate caption", () => {
    expect(BALANCE_CAPTION).toBe("shared across Omni products");
  });
});

describe("formatPerPartEstimate", () => {
  test("estimates from the last actual spend (self-calibrating)", () => {
    expect(formatPerPartEstimate(11)).toBe("about 11 credits per part");
    expect(formatPerPartEstimate(1)).toBe("about 1 credit per part");
  });

  test("falls back to a soft range before any run, and on a non-positive value", () => {
    expect(formatPerPartEstimate(null)).toBe("usually a few credits per part");
    expect(formatPerPartEstimate(0)).toBe("usually a few credits per part");
  });

  test("carries no middot separator", () => {
    expect(formatPerPartEstimate(11)).not.toContain("·");
  });
});

describe("phaseLabel", () => {
  test("gives a plain status for each step, with no trailing ellipsis", () => {
    expect(phaseLabel("generating")).toBe("Generating your part");
    expect(phaseLabel("checking")).toBe("Checking the render");
    expect(phaseLabel("refining")).toBe("Refining for accuracy");
    for (const phase of ["generating", "checking", "refining"] as const) {
      expect(phaseLabel(phase)).not.toContain("...");
    }
  });

  test("never exposes the under-the-hood critic", () => {
    expect(phaseLabel("checking").toLowerCase()).not.toContain("critiqu");
  });
});

describe("withProvenanceHeader", () => {
  test("prepends an attribution + prompt header above the code", () => {
    const out = withProvenanceHeader("return cube(10);", "a 10mm cube");
    expect(out).toContain("// Generated by Facet AI");
    expect(out).toContain("// Prompt:");
    expect(out).toContain("//   a 10mm cube");
    // the original code is preserved, after the header
    expect(out.endsWith("return cube(10);")).toBe(true);
    expect(out.indexOf("Generated by Facet AI")).toBeLessThan(
      out.indexOf("return cube(10);"),
    );
  });

  test("comments every line of a multi-line prompt", () => {
    const out = withProvenanceHeader("return x;", "line one\nline two");
    expect(out).toContain("//   line one");
    expect(out).toContain("//   line two");
  });

  test("the header is all comments, so it never changes what the code does", () => {
    const out = withProvenanceHeader("return cube(10);", "a cube");
    const header = out.slice(0, out.indexOf("return cube(10);"));
    for (const line of header.split("\n").filter((l) => l.trim())) {
      expect(line.trimStart().startsWith("//")).toBe(true);
    }
  });
});

describe("formatSpentNote", () => {
  test("reports the credits a failed attempt still cost", () => {
    expect(formatSpentNote(2)).toBe("2 credits spent.");
    expect(formatSpentNote(1)).toBe("1 credit spent.");
  });
});

describe("PROMPT_SUGGESTIONS", () => {
  test("offers more distinct examples than show at once, so More ideas has more", () => {
    expect(PROMPT_SUGGESTIONS.length).toBeGreaterThan(PROMPT_SUGGESTION_COUNT);
    expect(new Set(PROMPT_SUGGESTIONS).size).toBe(PROMPT_SUGGESTIONS.length);
  });

  test("keeps each example short enough for a chip", () => {
    for (const suggestion of PROMPT_SUGGESTIONS) {
      expect(suggestion.trim().length).toBeGreaterThan(0);
      expect(suggestion.length).toBeLessThanOrEqual(56);
      expect(suggestion).not.toContain("\u2014");
      expect(suggestion).not.toMatch(/[.!?]$/);
    }
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

  test("the sign-in prompt offers BYOK as the escape hatch", () => {
    expect(PANEL_COPY.signInPrompt).toContain("Synapse key");
  });
});

describe("stripProvenanceHeader", () => {
  test("removes the header so the gateway sees clean code", () => {
    const stamped = withProvenanceHeader("return cube(10);", "a 10mm cube");
    expect(stripProvenanceHeader(stamped)).toBe("return cube(10);");
  });

  test("removes a header stamped more than once", () => {
    const twice = `${withProvenanceHeader("", "line one\nline two")}${withProvenanceHeader("return x;", "line one\nline two")}`;
    expect(stripProvenanceHeader(twice)).toBe("return x;");
  });

  test("leaves code without a header untouched", () => {
    const code = "// a user comment\nreturn cube(10);";
    expect(stripProvenanceHeader(code)).toBe(code);
  });
});

describe("withProvenanceHeader on already stamped code", () => {
  test("stamps one header when a refine echoes or restores a stamped copy", () => {
    const once = withProvenanceHeader("return cube(10);", "a 10mm cube");
    const again = withProvenanceHeader(once, "a 10mm cube");
    expect(again.match(/Generated by Facet AI/g)).toHaveLength(1);
    expect(again.endsWith("return cube(10);")).toBe(true);
  });
});

describe("addCardLabel", () => {
  test("names the monthly free credits a card unlocks", () => {
    expect(addCardLabel(50)).toBe(
      "Add a card to unlock 50 free AI credits a month",
    );
  });
});
