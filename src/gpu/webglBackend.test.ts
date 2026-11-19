import { describe, expect, test } from "bun:test";

import { flipRows } from "./webglBackend";

describe("flipRows", () => {
  test("turns bottom-up readPixels rows into top-down rows", () => {
    // 1x3 image: bottom row 1, middle 2, top 3 as read back by WebGL
    const raw = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]);
    expect([...flipRows(raw, 1, 3)]).toEqual([
      3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1,
    ]);
  });
});
