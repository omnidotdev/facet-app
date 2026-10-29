import { mat4, vec3 } from "wgpu-matrix";

export type Vec3 = [number, number, number];

export interface BoundingSphere {
  center: Vec3;
  radius: number;
}

/** Fixed framing direction, matching the current three.js viewport. */
const FRAME_DIR: Vec3 = [1, -1, 0.7];

/** Compute eye/target/near/far to fit a bounding sphere, mirroring the old Viewport.frame. */
export const frameSphere = (
  sphere: BoundingSphere,
): { eye: Vec3; target: Vec3; near: number; far: number } => {
  const r = Math.max(sphere.radius, 1);
  const dist = r * 3;
  const dir = vec3.normalize(FRAME_DIR);
  const eye = vec3.addScaled(sphere.center, dir, dist);
  return {
    eye: [eye[0], eye[1], eye[2]],
    target: [...sphere.center],
    near: r / 100,
    far: r * 100,
  };
};

export interface CameraParams {
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  fovYRadians: number;
  aspect: number;
  near: number;
  far: number;
}

/** Build the combined view-projection matrix as a 16-element column-major array. */
export const viewProjection = (p: CameraParams): Float32Array => {
  const view = mat4.lookAt(p.eye, p.target, p.up);
  const proj = mat4.perspective(p.fovYRadians, p.aspect, p.near, p.far);
  return mat4.multiply(proj, view);
};
