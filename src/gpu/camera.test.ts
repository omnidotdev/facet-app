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

describe("orthographic viewProjection", () => {
  const project = (m: Float32Array, p: number[]) => {
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return [x / w, y / w, z / w];
  };
  const params = {
    eye: [0, -100, 0] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    up: [0, 0, 1] as [number, number, number],
    fovYRadians: Math.PI / 4,
    aspect: 1,
    near: 0.1,
    far: 1000,
  };

  it("matches perspective's span at the target plane", () => {
    const halfHeight = 100 * Math.tan(Math.PI / 8);
    const ortho = viewProjection({ ...params, orthographic: true });
    const persp = viewProjection(params);
    const top = [0, 0, halfHeight];
    expect(project(ortho, top)[1]).toBeCloseTo(1, 4);
    expect(project(persp, top)[1]).toBeCloseTo(1, 4);
  });

  it("keeps size independent of depth", () => {
    const ortho = viewProjection({ ...params, orthographic: true });
    const near = project(ortho, [0, -50, 10]);
    const far = project(ortho, [0, 50, 10]);
    expect(near[1]).toBeCloseTo(far[1], 6);
  });

  it("keeps geometry between the eye and the target, and just behind the eye, in depth range", () => {
    const ortho = viewProjection({ ...params, orthographic: true });
    for (const y of [-150, -99, 0, 200]) {
      const z = project(ortho, [0, y, 0])[2];
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(1);
    }
  });
});
