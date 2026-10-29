import { describe, expect, it } from "bun:test";

import { frameSphere, viewProjection } from "./camera";

describe("frameSphere", () => {
  it("places the camera at radius*3 along (1,-1,0.7) from the center", () => {
    const { eye, target, near, far } = frameSphere({
      center: [0, 0, 0],
      radius: 10,
    });
    expect(target).toEqual([0, 0, 0]);
    const dist = Math.hypot(eye[0], eye[1], eye[2]);
    expect(dist).toBeCloseTo(30, 3);
    expect(near).toBeCloseTo(0.1, 5);
    expect(far).toBeCloseTo(1000, 3);
  });

  it("clamps a degenerate radius to >= 1", () => {
    const { far } = frameSphere({ center: [0, 0, 0], radius: 0 });
    expect(far).toBeCloseTo(100, 3);
  });
});

describe("viewProjection", () => {
  it("returns a 16-float column-major matrix", () => {
    const m = viewProjection({
      eye: [0, -80, 60],
      target: [0, 0, 0],
      up: [0, 0, 1],
      fovYRadians: Math.PI / 4,
      aspect: 1,
      near: 0.1,
      far: 5000,
    });
    expect(m).toHaveLength(16);
    expect(Number.isFinite(m[0])).toBe(true);
  });
});
