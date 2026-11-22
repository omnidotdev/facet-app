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

describe("OrbitState view moves", () => {
  it("turns the short way round to a view", () => {
    const o = new OrbitState();
    o.lookFrom(-Math.PI / 2 + 4 * Math.PI, Math.PI / 2);
    // The target is within half a turn of where the camera already is
    expect(Math.abs(o.targetAzimuth - o.azimuth)).toBeLessThanOrEqual(Math.PI);
    o.settle();
    expect(Math.cos(o.azimuth)).toBeCloseTo(0, 6);
    expect(Math.sin(o.azimuth)).toBeCloseTo(-1, 6);
  });

  it("keeps a requested pole view off the pole", () => {
    const o = new OrbitState();
    o.lookFrom(0, 0);
    o.settle();
    expect(o.polar).toBeGreaterThan(0);
  });

  it("eases the target to a new center, and a pan takes over", () => {
    const o = new OrbitState();
    o.moveTarget([10, 0, 0]);
    o.update();
    expect(o.target[0]).toBeGreaterThan(0);
    expect(o.target[0]).toBeLessThan(10);
    for (let i = 0; i < 300; i++) o.update();
    expect(o.target[0]).toBeCloseTo(10, 3);

    o.moveTarget([20, 0, 0]);
    o.pan(0, 0);
    const held = o.target[0];
    o.update();
    expect(o.target[0]).toBe(held);
  });

  it("eases the radius to a zoom distance", () => {
    const o = new OrbitState();
    o.zoomTo(50);
    for (let i = 0; i < 300; i++) o.update();
    expect(o.radius).toBeCloseTo(50, 3);
  });
});
