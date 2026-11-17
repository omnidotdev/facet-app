/**
 * Pure helpers for reading a rendered frame back from the GPU, used by the
 * viewport's capture for the AI render critique. Kept free of WebGPU calls so
 * the byte layout, swizzle, blank check, and sizing are unit-testable
 */

/** WebGPU's required alignment for `bytesPerRow` in a texture-to-buffer copy */
const COPY_ROW_ALIGNMENT = 256;

/** Bytes per texel for the 8-bit RGBA/BGRA formats the viewport renders to */
const BYTES_PER_TEXEL = 4;

/** Below this many CSS pixels on either side the viewport is hidden or collapsed */
const MIN_VISIBLE_EDGE = 64;

/** `bytesPerRow` for a copy of a `width`-texel row, padded to the copy alignment */
export const alignedBytesPerRow = (width: number): number =>
  Math.ceil((width * BYTES_PER_TEXEL) / COPY_ROW_ALIGNMENT) *
  COPY_ROW_ALIGNMENT;

/**
 * Tightly packed RGBA pixels from a padded texture copy, swizzling BGRA to RGBA
 * when the texture format is `bgra8unorm` (the preferred canvas format on many
 * platforms)
 * @param bytes - The mapped copy, `bytesPerRow` bytes per row
 * @param width - Image width in texels
 * @param height - Image height in texels
 * @param bytesPerRow - The padded row stride of the copy
 * @param format - The source texture format
 */
export const unpackPixels = (
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
  format: string,
): Uint8ClampedArray<ArrayBuffer> => {
  if (format !== "rgba8unorm" && format !== "bgra8unorm") {
    throw new Error(`unsupported capture format: ${format}`);
  }
  const bgra = format === "bgra8unorm";
  const out = new Uint8ClampedArray(width * height * BYTES_PER_TEXEL);
  for (let y = 0; y < height; y += 1) {
    const src = y * bytesPerRow;
    const dst = y * width * BYTES_PER_TEXEL;
    if (!bgra) {
      out.set(bytes.subarray(src, src + width * BYTES_PER_TEXEL), dst);
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const s = src + x * BYTES_PER_TEXEL;
      const d = dst + x * BYTES_PER_TEXEL;
      out[d] = bytes[s + 2] ?? 0;
      out[d + 1] = bytes[s + 1] ?? 0;
      out[d + 2] = bytes[s] ?? 0;
      out[d + 3] = bytes[s + 3] ?? 0;
    }
  }
  return out;
};

/**
 * Whether every pixel is the same color: a frame that drew nothing (or a
 * readback that came back empty) is a blank capture, never worth critiquing
 */
export const isUniform = (pixels: Uint8ClampedArray): boolean => {
  if (pixels.length < BYTES_PER_TEXEL) return true;
  const [r, g, b, a] = [pixels[0], pixels[1], pixels[2], pixels[3]];
  for (let i = BYTES_PER_TEXEL; i < pixels.length; i += BYTES_PER_TEXEL) {
    if (
      pixels[i] !== r ||
      pixels[i + 1] !== g ||
      pixels[i + 2] !== b ||
      pixels[i + 3] !== a
    ) {
      return false;
    }
  }
  return true;
};

/**
 * The capture's pixel size: the on-screen viewport's aspect at a fixed long
 * edge, so the critic sees what the user sees at a predictable cost. Hidden or
 * collapsed viewports (the phone layout's code tab) capture a square, and the
 * short edge never drops below a third of the long one
 * @param width - Viewport width in CSS pixels
 * @param height - Viewport height in CSS pixels
 * @param longEdge - The capture's long edge in pixels
 */
export const captureSize = (
  width: number,
  height: number,
  longEdge: number,
): { width: number; height: number } => {
  if (width < MIN_VISIBLE_EDGE || height < MIN_VISIBLE_EDGE) {
    return { width: longEdge, height: longEdge };
  }
  const minShort = Math.round(longEdge / 3);
  const short = (a: number, b: number) =>
    Math.max(minShort, Math.round((a / b) * longEdge));
  return width >= height
    ? { width: longEdge, height: short(height, width) }
    : { width: short(width, height), height: longEdge };
};
