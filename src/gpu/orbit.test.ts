import { describe, expect, it } from "bun:test";

import { OrbitState } from "./orbit";

describe("OrbitState", () => {
  it("clamps the polar angle out of the poles", () => {
    const o = new OrbitState();
    o.rotate(0, -10); // try to push past the top pole
    o.settle();
    expect(o.polar).toBeGreaterThan(0);
    expect(o.polar).toBeLessThan(Math.PI);
  });

  it("keeps radius positive when dollying in hard", () => {
    const o = new OrbitState();
    o.dolly(-1000);
    o.settle();
    expect(o.radius).toBeGreaterThan(0);
  });

  it("converges to the target angle after repeated damping steps", () => {
    const o = new OrbitState();
    o.rotate(1, 0);
    for (let i = 0; i < 200; i++) o.update();
    expect(o.azimuth).toBeCloseTo(o.targetAzimuth, 4);
  });
});
