import type { Rgba } from "./palette";

/** The graphics API a viewport renders through */
export type RendererKind = "webgpu" | "webgl";

/** Everything one frame needs, computed by the viewport and handed to a backend */
export interface FrameParams {
  /** Combined view-projection, column-major, WebGPU clip depth (0..1) */
  viewProj: Float32Array;
  lightDir: readonly [number, number, number];
  baseColor: Rgba;
  background: Rgba;
  /** Grid rgb plus its theme opacity in the fourth channel */
  grid: Rgba;
}

/**
 * A graphics backend that draws the Facet scene (ground grid plus the solid)
 * onto its canvas. The viewport owns the camera, input, and framing; a backend
 * only uploads geometry and draws, so WebGPU and the WebGL compatibility path
 * render the same frame from the same parameters
 */
export interface RenderBackend {
  readonly kind: RendererKind;
  /** Match the drawing buffer to the canvas size, in device pixels */
  resize(width: number, height: number): void;
  setMesh(
    positions: Float32Array,
    normals: Float32Array,
    triangleCount: number,
  ): void;
  /** Draw the on-screen frame */
  draw(frame: FrameParams): void;
  /**
   * Render one frame offscreen at a fixed size and read it back as tightly
   * packed RGBA rows, top row first, or null when the readback fails
   */
  capture(
    width: number,
    height: number,
    frame: FrameParams,
  ): Promise<Uint8ClampedArray<ArrayBuffer> | null>;
  dispose(): void;
}
