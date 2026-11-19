import { describe, expect, test } from "bun:test";

import {
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
});

test("rendererLabel names each renderer", () => {
  expect(rendererLabel("webgpu")).toBe("WebGPU");
  expect(rendererLabel("webgl")).toBe("WebGL");
});
