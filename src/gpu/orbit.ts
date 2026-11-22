import { vec3 } from "wgpu-matrix";

import { HOME_ANGLES, POLE_EPS, nearestAzimuth } from "./views";

import type { Vec3 } from "./camera";

/** Smallest offset kept between the polar angle and either pole */
const EPS = POLE_EPS;

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
 * The defaults are the home view (see views.ts), looking down at the model
 * from the (1, -1) quadrant.
 */
export class OrbitState {
  /** Orbit center in world space, moved by pan */
  target: Vec3 = [0, 0, 0];

  /** Where an animated recenter is easing the target toward, if anywhere */
  private goalTarget: Vec3 | null = null;

  private _azimuth: number;
  private _polar: number;
  private _radius: number;

  private _targetAzimuth: number;
  private _targetPolar: number;
  private _targetRadius: number;

  constructor() {
    const { azimuth, polar } = HOME_ANGLES;
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

  /**
   * Turn to look from the given angles, easing there through the damping. The
   * azimuth goes the short way round, so a view change never spins a full turn
   */
  lookFrom(azimuth: number, polar: number): void {
    this._targetAzimuth = nearestAzimuth(this._azimuth, azimuth);
    this._targetPolar = clamp(polar, EPS, Math.PI - EPS);
  }

  /** Ease the orbit center to a new point, as when framing the model */
  moveTarget(target: Vec3): void {
    this.goalTarget = [...target];
  }

  /** Ease the eye to a distance from the target */
  zoomTo(radius: number): void {
    this._targetRadius = Math.max(radius, MIN_RADIUS);
  }

  /** Shift the orbit target in the camera's screen plane (right/up, Z-up) */
  pan(deltaX: number, deltaY: number): void {
    // A direct pan takes over from any recenter still easing in
    this.goalTarget = null;
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
    const goal = this.goalTarget;
    if (goal) {
      this.target = [
        this.target[0] + (goal[0] - this.target[0]) * DAMPING,
        this.target[1] + (goal[1] - this.target[1]) * DAMPING,
        this.target[2] + (goal[2] - this.target[2]) * DAMPING,
      ];
    }
  }

  /** Snap the current state to the target immediately */
  settle(): void {
    this._azimuth = this._targetAzimuth;
    this._polar = this._targetPolar;
    this._radius = this._targetRadius;
    if (this.goalTarget) this.target = [...this.goalTarget];
    this.goalTarget = null;
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
