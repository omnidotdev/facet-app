import type { Theme } from "@/theme";

/** Color as normalized RGBA, each channel in 0..1, ready for GPU upload. */
export type Rgba = [number, number, number, number];

/** Theme colors the viewport needs, normalized for the scene uniforms. */
export interface Palette {
  background: Rgba;
  grid: Rgba;
  baseColor: Rgba;
}

/** Parse a #rrggbb hex string into normalized RGBA with the given alpha. */
const hexToRgba = (hex: string, alpha: number): Rgba => {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [
    ((n >> 16) & 0xff) / 255,
    ((n >> 8) & 0xff) / 255,
    (n & 0xff) / 255,
    alpha,
  ];
};

/** Facet Amber, the base color shared by every theme. */
const BASE_COLOR = "#dd6e33";

/** Resolve the normalized palette for a theme (single source of truth for viewport colors). */
export const paletteFor = (theme: Theme): Palette =>
  theme === "dark"
    ? {
        background: hexToRgba("#0d2033", 1),
        grid: hexToRgba("#3a4654", 0.35),
        baseColor: hexToRgba(BASE_COLOR, 1),
      }
    : {
        background: hexToRgba("#e7e2d8", 1),
        grid: hexToRgba("#b7ab90", 0.6),
        baseColor: hexToRgba(BASE_COLOR, 1),
      };
