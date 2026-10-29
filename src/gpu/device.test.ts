import { describe, expect, it } from "bun:test";

import { acquireDevice, isWebGpuSupported } from "./device";

describe("isWebGpuSupported", () => {
  it("is false when navigator.gpu is absent", () => {
    expect(isWebGpuSupported({} as Navigator)).toBe(false);
  });

  it("is true when navigator.gpu is present", () => {
    expect(isWebGpuSupported({ gpu: {} } as unknown as Navigator)).toBe(true);
  });
});

describe("acquireDevice", () => {
  it("returns null when navigator.gpu is absent", async () => {
    expect(await acquireDevice({} as Navigator)).toBeNull();
  });

  it("returns null when requestAdapter yields nothing", async () => {
    const nav = {
      gpu: { requestAdapter: async () => null },
    } as unknown as Navigator;
    expect(await acquireDevice(nav)).toBeNull();
  });

  it("returns the device from the adapter", async () => {
    const device = {} as GPUDevice;
    const nav = {
      gpu: {
        requestAdapter: async () => ({ requestDevice: async () => device }),
      },
    } as unknown as Navigator;
    expect(await acquireDevice(nav)).toBe(device);
  });
});
