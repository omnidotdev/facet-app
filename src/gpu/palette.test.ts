import { describe, expect, it } from "bun:test";

import { paletteFor } from "./palette";

describe("paletteFor", () => {
  it("maps dark theme background to normalized RGBA", () => {
    const p = paletteFor("dark");
    // #0D2033 -> 13,32,51
    expect(p.background[0]).toBeCloseTo(13 / 255, 5);
    expect(p.background[1]).toBeCloseTo(32 / 255, 5);
    expect(p.background[2]).toBeCloseTo(51 / 255, 5);
    expect(p.background[3]).toBe(1);
  });

  it("carries the theme grid color and its opacity in the alpha channel", () => {
    const p = paletteFor("dark");
    expect(p.grid[3]).toBeCloseTo(0.35, 5);
  });

  it("exposes Facet Amber as the base color", () => {
    const p = paletteFor("light");
    // #DD6E33 -> 221,110,51
    expect(p.baseColor[0]).toBeCloseTo(0xdd / 255, 5);
    expect(p.baseColor[3]).toBe(1);
  });
});
