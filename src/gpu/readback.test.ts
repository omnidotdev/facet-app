import { describe, expect, test } from "bun:test";

import {
  alignedBytesPerRow,
  captureSize,
  isUniform,
  unpackPixels,
} from "./readback";

describe("alignedBytesPerRow", () => {
  test("pads a row of 4-byte texels to the 256-byte copy alignment", () => {
    expect(alignedBytesPerRow(1)).toBe(256);
    expect(alignedBytesPerRow(64)).toBe(256);
    expect(alignedBytesPerRow(65)).toBe(512);
    expect(alignedBytesPerRow(768)).toBe(3072);
  });
});

describe("unpackPixels", () => {
  // 2x2 image, rows padded to 256 bytes; texel (x, y) = [x, y, 9, 255]
  const padded = (format: "rgba8unorm" | "bgra8unorm") => {
    const bpr = alignedBytesPerRow(2);
    const bytes = new Uint8Array(bpr * 2).fill(77);
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        const i = y * bpr + x * 4;
        const [r, g, b, a] = [x, y, 9, 255];
        if (format === "bgra8unorm") bytes.set([b, g, r, a], i);
        else bytes.set([r, g, b, a], i);
      }
    }
    return { bytes, bpr };
  };

  test("drops the row padding and keeps RGBA order", () => {
    const { bytes, bpr } = padded("rgba8unorm");
    expect([...unpackPixels(bytes, 2, 2, bpr, "rgba8unorm")]).toEqual([
      0, 0, 9, 255, 1, 0, 9, 255, 0, 1, 9, 255, 1, 1, 9, 255,
    ]);
  });

  test("swizzles BGRA to RGBA", () => {
    const { bytes, bpr } = padded("bgra8unorm");
    expect([...unpackPixels(bytes, 2, 2, bpr, "bgra8unorm")]).toEqual([
      0, 0, 9, 255, 1, 0, 9, 255, 0, 1, 9, 255, 1, 1, 9, 255,
    ]);
  });

  test("rejects an unsupported texel format", () => {
    expect(() =>
      unpackPixels(new Uint8Array(512), 1, 1, 256, "rgba16float"),
    ).toThrow();
  });
});

describe("isUniform", () => {
  test("a single flat color is blank", () => {
    const px = new Uint8ClampedArray(4 * 16);
    for (let i = 0; i < px.length; i += 4) px.set([12, 34, 56, 255], i);
    expect(isUniform(px)).toBe(true);
    expect(isUniform(new Uint8ClampedArray(4 * 16))).toBe(true);
  });

  test("any differing pixel is not blank", () => {
    const px = new Uint8ClampedArray(4 * 16);
    px[4 * 9 + 1] = 1;
    expect(isUniform(px)).toBe(false);
  });

  test("an empty image is blank", () => {
    expect(isUniform(new Uint8ClampedArray(0))).toBe(true);
  });
});

describe("captureSize", () => {
  test("keeps the viewport's aspect at a fixed long edge", () => {
    expect(captureSize(1600, 900, 768)).toEqual({ width: 768, height: 432 });
    expect(captureSize(900, 1600, 768)).toEqual({ width: 432, height: 768 });
  });

  test("falls back to a square when the viewport is hidden or collapsed", () => {
    expect(captureSize(0, 0, 768)).toEqual({ width: 768, height: 768 });
    expect(captureSize(1, 1, 768)).toEqual({ width: 768, height: 768 });
    expect(captureSize(1200, 2, 768)).toEqual({ width: 768, height: 768 });
  });

  test("never goes below a usable short edge for a very wide viewport", () => {
    expect(captureSize(4000, 400, 768)).toEqual({ width: 768, height: 256 });
  });
});
