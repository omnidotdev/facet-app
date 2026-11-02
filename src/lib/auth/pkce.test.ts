import { describe, expect, test } from "bun:test";

import {
  base64UrlEncode,
  buildAuthorizeUrl,
  buildTokenRequestBody,
  codeChallengeS256,
  parseCallbackParams,
  parseTokenResponse,
  randomBase64Url,
} from "./pkce";

describe("base64UrlEncode", () => {
  test("uses the url-safe alphabet and strips padding", () => {
    // Bytes chosen so standard base64 would contain '+' and '/' and padding
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
    const encoded = base64UrlEncode(bytes);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect(encoded).toBe("-_-_");
  });
});

describe("randomBase64Url", () => {
  test("produces distinct url-safe strings", () => {
    const a = randomBase64Url(32);
    const b = randomBase64Url(32);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("codeChallengeS256", () => {
  test("matches the RFC 7636 appendix B test vector", async () => {
    // The canonical PKCE example verifier -> challenge pair
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await codeChallengeS256(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("buildAuthorizeUrl", () => {
  test("targets /oauth2/authorize with S256 and encodes params", () => {
    const url = buildAuthorizeUrl({
      authBaseUrl: "https://identity.omni.dev/",
      clientId: "abc123",
      redirectUri: "https://facet.omni.dev/auth/callback",
      scope: "openid profile email",
      state: "st@te",
      codeChallenge: "chal",
    });
    expect(url.startsWith("https://identity.omni.dev/oauth2/authorize?")).toBe(
      true,
    );
    const query = new URL(url).searchParams;
    expect(query.get("response_type")).toBe("code");
    expect(query.get("client_id")).toBe("abc123");
    expect(query.get("redirect_uri")).toBe(
      "https://facet.omni.dev/auth/callback",
    );
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("state")).toBe("st@te");
  });
});

describe("parseCallbackParams", () => {
  test("extracts code and state, tolerating a leading ?", () => {
    expect(parseCallbackParams("?code=xyz&state=abc")).toEqual({
      ok: true,
      code: "xyz",
      state: "abc",
    });
  });

  test("reports a provider error", () => {
    expect(parseCallbackParams("?error=access_denied")).toEqual({
      ok: false,
      error: "access_denied",
    });
  });

  test("treats a missing code or state as an error", () => {
    expect(parseCallbackParams("?code=only").ok).toBe(false);
    expect(parseCallbackParams("").ok).toBe(false);
  });
});

describe("buildTokenRequestBody", () => {
  test("is a public-client authorization_code grant with the verifier, no secret", () => {
    const body = buildTokenRequestBody({
      clientId: "abc123",
      redirectUri: "https://facet.omni.dev/auth/callback",
      code: "the code",
      codeVerifier: "the-verifier",
    });
    const form = new URLSearchParams(body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("client_id")).toBe("abc123");
    expect(form.get("code")).toBe("the code");
    expect(form.get("code_verifier")).toBe("the-verifier");
    expect(form.has("client_secret")).toBe(false);
  });
});

describe("parseTokenResponse", () => {
  test("pulls the access token and lifetime", () => {
    expect(
      parseTokenResponse({ access_token: "tok", expires_in: 3600 }),
    ).toEqual({ accessToken: "tok", expiresIn: 3600 });
  });

  test("tolerates a missing lifetime", () => {
    expect(parseTokenResponse({ access_token: "tok" })).toEqual({
      accessToken: "tok",
      expiresIn: null,
    });
  });

  test("returns null without an access token", () => {
    expect(parseTokenResponse({ token_type: "bearer" })).toBeNull();
    expect(parseTokenResponse(null)).toBeNull();
    expect(parseTokenResponse("nope")).toBeNull();
  });
});
