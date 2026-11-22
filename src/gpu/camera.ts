import { mat4, vec3 } from "wgpu-matrix";

import { HOME_DIRECTION } from "./views";

export type Vec3 = [number, number, number];

export interface BoundingSphere {
  center: Vec3;
  radius: number;
}

/** Compute eye/target/near/far to fit a bounding sphere, mirroring the old Viewport.frame. */
export const frameSphere = (
  sphere: BoundingSphere,
): { eye: Vec3; target: Vec3; near: number; far: number } => {
  const r = Math.max(sphere.radius, 1);
  const dist = r * 3;
  const dir = vec3.normalize(HOME_DIRECTION);
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
  /**
   * Draw with an orthographic projection instead of perspective, sized so
   * the plane through the target shows the same span it would in perspective
   */
  orthographic?: boolean;
}

/** Build the combined view-projection matrix as a 16-element column-major array. */
export const viewProjection = (p: CameraParams): Float32Array => {
  const view = mat4.lookAt(p.eye, p.target, p.up);
  if (!p.orthographic) {
    const proj = mat4.perspective(p.fovYRadians, p.aspect, p.near, p.far);
    return mat4.multiply(proj, view);
  }
  const distance = Math.hypot(
    p.eye[0] - p.target[0],
    p.eye[1] - p.target[1],
    p.eye[2] - p.target[2],
  );
  const halfHeight = distance * Math.tan(p.fovYRadians / 2);
  const halfWidth = halfHeight * p.aspect;
  // An orthographic view has no vanishing point, so depth can reach behind
  // the eye: clip symmetrically around it so a close zoom never slices the
  // part that sits between the eye and the target
  const proj = mat4.ortho(
    -halfWidth,
    halfWidth,
    -halfHeight,
    halfHeight,
    -p.far,
    p.far,
  );
  return mat4.multiply(proj, view);
};
