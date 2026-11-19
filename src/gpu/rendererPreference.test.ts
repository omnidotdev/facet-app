import { describe, expect, test } from "bun:test";

import {
  isDesktopLinux,
  parseRendererPreference,
  rendererLabel,
  rendererOrder,
} from "./rendererPreference";

describe("parseRendererPreference", () => {
  test("keeps a known preference", () => {
    expect(parseRendererPreference("webgl")).toBe("webgl");
    expect(parseRendererPreference("webgpu")).toBe("webgpu");
    expect(parseRendererPreference("auto")).toBe("auto");
  });

  test("defaults anything else to auto", () => {
    expect(parseRendererPreference(null)).toBe("auto");
    expect(parseRendererPreference("WEBGL")).toBe("auto");
    expect(parseRendererPreference(3)).toBe("auto");
  });
});

describe("rendererOrder", () => {
  test("auto and webgpu try WebGPU first and fall back to WebGL", () => {
    expect(rendererOrder("auto")).toEqual(["webgpu", "webgl"]);
    expect(rendererOrder("webgpu")).toEqual(["webgpu", "webgl"]);
  });

  test("webgl skips WebGPU entirely", () => {
    expect(rendererOrder("webgl")).toEqual(["webgl"]);
  });

  test("auto starts with WebGL on desktop Linux", () => {
    expect(rendererOrder("auto", true)).toEqual(["webgl", "webgpu"]);
  });

  test("an explicit WebGPU choice is honored on desktop Linux", () => {
    expect(rendererOrder("webgpu", true)).toEqual(["webgpu", "webgl"]);
  });
});

describe("isDesktopLinux", () => {
  test("trusts the client hint platform when present", () => {
    expect(isDesktopLinux({ userAgentData: { platform: "Linux" } })).toBe(true);
    expect(isDesktopLinux({ userAgentData: { platform: "Android" } })).toBe(
      false,
    );
    expect(isDesktopLinux({ userAgentData: { platform: "Chrome OS" } })).toBe(
      false,
    );
  });

  test("reads the user agent otherwise", () => {
    expect(
      isDesktopLinux({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Firefox/140.0",
      }),
    ).toBe(true);
    expect(
      isDesktopLinux({
        userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/141.0",
      }),
    ).toBe(false);
    expect(
      isDesktopLinux({
        userAgent: "Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) Chrome/141.0",
      }),
    ).toBe(false);
    expect(
      isDesktopLinux({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Safari/605",
      }),
    ).toBe(false);
  });
});

test("rendererLabel names each renderer", () => {
  expect(rendererLabel("webgpu")).toBe("WebGPU");
  expect(rendererLabel("webgl")).toBe("WebGL");
});
