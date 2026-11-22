import { describe, expect, test } from "bun:test";

import {
  AXIS_VIEWS,
  OPPOSITE,
  ORBIT_STEP,
  cameraBasis,
  currentAxisView,
  fitView,
  gizmoAxes,
  nearestAzimuth,
  viewKeyAction,
  wrapAngle,
} from "./views";

import type { AxisView } from "./views";

const expectVec = (actual: number[], expected: number[]) => {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 2);
};

describe("axis views", () => {
  // Screen right and screen up for each view, the conventional layout
  const layout: Record<AxisView, { right: number[]; up: number[] }> = {
    front: { right: [1, 0, 0], up: [0, 0, 1] },
    back: { right: [-1, 0, 0], up: [0, 0, 1] },
    right: { right: [0, 1, 0], up: [0, 0, 1] },
    left: { right: [0, -1, 0], up: [0, 0, 1] },
    top: { right: [1, 0, 0], up: [0, 1, 0] },
    bottom: { right: [1, 0, 0], up: [0, -1, 0] },
  };

  for (const [view, { right, up }] of Object.entries(layout) as [
    AxisView,
    { right: number[]; up: number[] },
  ][]) {
    test(`${view} puts the expected axes right and up`, () => {
      const { azimuth, polar } = AXIS_VIEWS[view];
      const basis = cameraBasis(azimuth, polar);
      expectVec(basis.right, right);
      expectVec(basis.up, up);
    });
  }

  test("every view's opposite looks the other way", () => {
    for (const view of Object.keys(AXIS_VIEWS) as AxisView[]) {
      const a = AXIS_VIEWS[view];
      const b = AXIS_VIEWS[OPPOSITE[view]];
      const fa = cameraBasis(a.azimuth, a.polar).forward;
      const fb = cameraBasis(b.azimuth, b.polar).forward;
      expectVec(
        fa,
        fb.map((v) => -v),
      );
    }
  });

  test("recognizes the axis view the camera is in", () => {
    const { azimuth, polar } = AXIS_VIEWS.right;
    expect(currentAxisView(azimuth + 2 * Math.PI, polar)).toBe("right");
    expect(currentAxisView(azimuth + 0.3, polar)).toBeNull();
  });
});

describe("azimuth wrapping", () => {
  test("wraps into [-PI, PI)", () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI, 6);
    expect(wrapAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 6);
  });

  test("turns the short way round", () => {
    // From just past +PI, -PI + 0.1 is a 0.2 turn ahead, not a full spin back
    const next = nearestAzimuth(Math.PI - 0.1, -Math.PI + 0.1);
    expect(next).toBeCloseTo(Math.PI + 0.1, 6);
    // Many turns in, the target stays within half a turn
    const far = nearestAzimuth(20 * Math.PI, 0);
    expect(Math.abs(far - 20 * Math.PI)).toBeLessThanOrEqual(Math.PI);
  });
});

describe("gizmo projection", () => {
  test("from the front, X points right, Z up, and +Y away", () => {
    const { azimuth, polar } = AXIS_VIEWS.front;
    const axes = gizmoAxes(azimuth, polar);
    const end = (view: AxisView) => axes.find((a) => a.view === view);
    expect(end("right")?.x).toBeCloseTo(1, 3);
    expect(end("top")?.y).toBeCloseTo(1, 3);
    expect(end("back")?.depth).toBeCloseTo(1, 3);
    // Farthest first, so the nearer ends draw on top
    expect(axes[0].view).toBe("back");
    expect(axes[axes.length - 1].view).toBe("front");
  });
});

describe("view keys", () => {
  const key = (code: string, mods: Partial<{ ctrlKey: boolean }> = {}) =>
    viewKeyAction({
      code,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      ...mods,
    });

  test("numpad and top-row digits pick the axis views", () => {
    expect(key("Numpad1")).toEqual({ kind: "view", view: "front" });
    expect(key("Digit3")).toEqual({ kind: "view", view: "right" });
    expect(key("Numpad7")).toEqual({ kind: "view", view: "top" });
  });

  test("Ctrl picks the opposite side", () => {
    expect(key("Numpad1", { ctrlKey: true })).toEqual({
      kind: "view",
      view: "back",
    });
    expect(key("Numpad7", { ctrlKey: true })).toEqual({
      kind: "view",
      view: "bottom",
    });
  });

  test("flip, projection, and frame keys", () => {
    expect(key("Numpad9")).toEqual({ kind: "opposite" });
    expect(key("Numpad5")).toEqual({ kind: "projection" });
    expect(key("NumpadDecimal")).toEqual({ kind: "frame" });
    expect(key("Home")).toEqual({ kind: "frame" });
  });

  test("ignores other keys and browser shortcuts", () => {
    expect(key("KeyA")).toBeNull();
    expect(key("KeyZ")).toBeNull();
    expect(key("Digit5", { ctrlKey: true })).toBeNull();
    expect(
      viewKeyAction({
        code: "Digit1",
        ctrlKey: false,
        metaKey: true,
        altKey: false,
      }),
    ).toBeNull();
  });
});

describe("more view keys", () => {
  const key = (code: string) =>
    viewKeyAction({ code, ctrlKey: false, metaKey: false, altKey: false });

  test("0 returns home", () => {
    expect(key("Numpad0")).toEqual({ kind: "view", view: "home" });
    expect(key("Digit0")).toEqual({ kind: "view", view: "home" });
  });

  test("4/6/8/2 and the arrows orbit in steps", () => {
    expect(key("Numpad4")).toEqual({
      kind: "orbit",
      azimuth: -ORBIT_STEP,
      polar: 0,
    });
    expect(key("ArrowRight")).toEqual({
      kind: "orbit",
      azimuth: ORBIT_STEP,
      polar: 0,
    });
    expect(key("Digit8")).toEqual({
      kind: "orbit",
      azimuth: 0,
      polar: -ORBIT_STEP,
    });
    expect(key("ArrowDown")).toEqual({
      kind: "orbit",
      azimuth: 0,
      polar: ORBIT_STEP,
    });
  });

  test("plus and minus zoom in and out", () => {
    const zoomIn = key("NumpadAdd");
    const zoomOut = key("Minus");
    expect(zoomIn?.kind).toBe("zoom");
    expect(zoomOut?.kind).toBe("zoom");
    if (zoomIn?.kind === "zoom" && zoomOut?.kind === "zoom") {
      expect(zoomIn.factor).toBeLessThan(1);
      expect(zoomOut.factor).toBeGreaterThan(1);
    }
  });

  test("period frames the model too", () => {
    expect(key("Period")).toEqual({ kind: "frame" });
  });
});

describe("fitView", () => {
  const fov = Math.PI / 4;

  test("an orthographic top view fits the larger of width and height", () => {
    // A 40 x 20 plate seen from the top on a square view: width governs
    const { target, distance } = fitView(
      [-20, -10, 0],
      [20, 10, 2],
      AXIS_VIEWS.top,
      1,
      fov,
      true,
      1,
    );
    expect(target).toEqual([0, 0, 1]);
    expect(distance * Math.tan(fov / 2)).toBeCloseTo(20, 2);
  });

  test("a wide view lets width take more room", () => {
    const square = fitView(
      [-20, -10, 0],
      [20, 10, 2],
      AXIS_VIEWS.top,
      1,
      fov,
      true,
      1,
    );
    const wide = fitView(
      [-20, -10, 0],
      [20, 10, 2],
      AXIS_VIEWS.top,
      2,
      fov,
      true,
      1,
    );
    expect(wide.distance).toBeLessThan(square.distance);
  });

  test("perspective pulls back by the nearest corner's depth", () => {
    const ortho = fitView(
      [-5, -5, -5],
      [5, 5, 5],
      AXIS_VIEWS.front,
      1,
      fov,
      true,
      1,
    );
    const persp = fitView(
      [-5, -5, -5],
      [5, 5, 5],
      AXIS_VIEWS.front,
      1,
      fov,
      false,
      1,
    );
    expect(persp.distance - ortho.distance).toBeCloseTo(5, 3);
  });

  test("the margin leaves room around the model", () => {
    const tight = fitView(
      [-5, -5, -5],
      [5, 5, 5],
      AXIS_VIEWS.front,
      1,
      fov,
      true,
      1,
    );
    const roomy = fitView(
      [-5, -5, -5],
      [5, 5, 5],
      AXIS_VIEWS.front,
      1,
      fov,
      true,
      1.2,
    );
    expect(roomy.distance / tight.distance).toBeCloseTo(1.2, 6);
  });
});
