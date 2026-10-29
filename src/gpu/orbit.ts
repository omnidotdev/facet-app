import { vec3 } from "wgpu-matrix";

import type { Vec3 } from "./camera";

/** Smallest offset kept between the polar angle and either pole */
const EPS = 1e-3;

/** Exponential smoothing factor applied each update toward the target state */
const DAMPING = 0.15;

/** Lowest radius allowed so the eye never collapses onto the target */
const MIN_RADIUS = 0.01;

/**
 * Spherical orbit convention (Z-up, matching src/gpu/camera.ts):
 *
 * - azimuth: angle in the world XY plane measured from +X toward +Y (around +Z)
 * - polar: angle down from the +Z axis, in [EPS, PI - EPS] so the eye never
 *   reaches a pole
 * - radius: distance from the orbit target to the eye
 *
 * The eye offset from the target is therefore
 *   [ sin(polar) * cos(azimuth), sin(polar) * sin(azimuth), cos(polar) ] * radius
 *
 * The defaults reproduce the old three.js framing direction (1, -1, 0.7):
 * azimuth -PI/4 and polar acos(0.7 / |(1, -1, 0.7)|) look down at the model
 * from the same quadrant.
 */
export class OrbitState {
  /** Orbit center in world space, moved by pan */
  target: Vec3 = [0, 0, 0];

  private _azimuth: number;
  private _polar: number;
  private _radius: number;

  private _targetAzimuth: number;
  private _targetPolar: number;
  private _targetRadius: number;

  constructor() {
    const dir = vec3.normalize([1, -1, 0.7]);
    const azimuth = Math.atan2(dir[1], dir[0]);
    const polar = Math.acos(dir[2]);
    const radius = 3;

    this._azimuth = azimuth;
    this._polar = polar;
    this._radius = radius;
    this._targetAzimuth = azimuth;
    this._targetPolar = polar;
    this._targetRadius = radius;
  }

  get azimuth(): number {
    return this._azimuth;
  }

  get polar(): number {
    return this._polar;
  }

  get radius(): number {
    return this._radius;
  }

  get targetAzimuth(): number {
    return this._targetAzimuth;
  }

  get targetPolar(): number {
    return this._targetPolar;
  }

  get targetRadius(): number {
    return this._targetRadius;
  }

  /** Adjust the target azimuth and polar, clamping polar away from the poles */
  rotate(deltaAzimuth: number, deltaPolar: number): void {
    this._targetAzimuth += deltaAzimuth;
    this._targetPolar = clamp(
      this._targetPolar + deltaPolar,
      EPS,
      Math.PI - EPS,
    );
  }

  /** Shift the orbit target in the camera's screen plane (right/up, Z-up) */
  pan(deltaX: number, deltaY: number): void {
    const forward = this.forward();
    const right = vec3.normalize(vec3.cross(forward, [0, 0, 1]));
    const up = vec3.cross(right, forward);
    const moved = vec3.addScaled(this.target, right, -deltaX);
    const shifted = vec3.addScaled(moved, up, deltaY);
    this.target = [shifted[0], shifted[1], shifted[2]];
  }

  /** Adjust the target radius, clamped to a small positive minimum */
  dolly(deltaRadius: number): void {
    this._targetRadius = Math.max(this._targetRadius + deltaRadius, MIN_RADIUS);
  }

  /** Advance the current state toward the target by the damping factor */
  update(): void {
    this._azimuth += (this._targetAzimuth - this._azimuth) * DAMPING;
    this._polar += (this._targetPolar - this._polar) * DAMPING;
    this._radius += (this._targetRadius - this._radius) * DAMPING;
  }

  /** Snap the current state to the target immediately */
  settle(): void {
    this._azimuth = this._targetAzimuth;
    this._polar = this._targetPolar;
    this._radius = this._targetRadius;
  }

  /** World-space eye position from the current spherical coords around target */
  eye(): Vec3 {
    const sinPolar = Math.sin(this._polar);
    const offset: Vec3 = [
      sinPolar * Math.cos(this._azimuth),
      sinPolar * Math.sin(this._azimuth),
      Math.cos(this._polar),
    ];
    const eye = vec3.addScaled(this.target, offset, this._radius);
    return [eye[0], eye[1], eye[2]];
  }

  /** Unit direction from the eye toward the target, using current angles */
  private forward(): Vec3 {
    const sinPolar = Math.sin(this._polar);
    return [
      -sinPolar * Math.cos(this._azimuth),
      -sinPolar * Math.sin(this._azimuth),
      -Math.cos(this._polar),
    ];
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);
