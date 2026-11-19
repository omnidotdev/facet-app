/**
 * Ground grid geometry shared by the WebGPU and WebGL backends, so both draw
 * the same blueprint grid
 */

/** Half-extent of the ground quad, in world units */
const GRID_HALF_EXTENT = 1000;

/** World-space spacing between grid lines (10 mm) */
export const GRID_CELL = 10;

/** Where the radial fade starts and ends, so the fixed quad has no hard edge */
export const GRID_FADE_START = GRID_HALF_EXTENT * 0.35;
export const GRID_FADE_END = GRID_HALF_EXTENT * 0.95;

/** Two triangles covering the quad on the XY plane at z = 0 */
export const GRID_QUAD = new Float32Array([
  -GRID_HALF_EXTENT,
  -GRID_HALF_EXTENT,
  0,
  GRID_HALF_EXTENT,
  -GRID_HALF_EXTENT,
  0,
  -GRID_HALF_EXTENT,
  GRID_HALF_EXTENT,
  0,
  -GRID_HALF_EXTENT,
  GRID_HALF_EXTENT,
  0,
  GRID_HALF_EXTENT,
  -GRID_HALF_EXTENT,
  0,
  GRID_HALF_EXTENT,
  GRID_HALF_EXTENT,
  0,
]);
