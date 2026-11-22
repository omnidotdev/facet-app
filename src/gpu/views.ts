import { vec3 } from "wgpu-matrix";

import type { Vec3 } from "./camera";

/**
 * Standard viewpoints for the Z-up orbit camera, and the math the view gizmo
 * and the view shortcuts share. Angles follow the orbit convention in
 * orbit.ts: azimuth around +Z from +X, polar down from +Z.
 *
 * The axis views match the conventional 3D-app layout: front looks along +Y
 * with X to the right and Z up, right looks along -X with Y to the right, and
 * top looks down with X to the right and Y up.
 */

/** Smallest offset kept between the polar angle and either pole */
export const POLE_EPS = 1e-3;

/** A camera direction as orbit angles */
export interface ViewAngles {
  azimuth: number;
  polar: number;
}

export type AxisView = "front" | "back" | "right" | "left" | "top" | "bottom";

export type ViewName = AxisView | "home";

const HALF_PI = Math.PI / 2;

/** Where each axis view puts the eye, in orbit angles */
export const AXIS_VIEWS: Record<AxisView, ViewAngles> = {
  front: { azimuth: -HALF_PI, polar: HALF_PI },
  back: { azimuth: HALF_PI, polar: HALF_PI },
  right: { azimuth: 0, polar: HALF_PI },
  left: { azimuth: Math.PI, polar: HALF_PI },
  top: { azimuth: -HALF_PI, polar: POLE_EPS },
  bottom: { azimuth: -HALF_PI, polar: Math.PI - POLE_EPS },
};

/** The axis view looking from the other side */
export const OPPOSITE: Record<AxisView, AxisView> = {
  front: "back",
  back: "front",
  right: "left",
  left: "right",
  top: "bottom",
  bottom: "top",
};

/** Human labels, for buttons, tooltips, and the command palette */
export const VIEW_LABELS: Record<ViewName, string> = {
  front: "Front",
  back: "Back",
  right: "Right",
  left: "Left",
  top: "Top",
  bottom: "Bottom",
  home: "Home",
};

/**
 * The default three-quarter view, looking down at the model from the (1, -1)
 * quadrant. The orbit state starts here too
 */
export const HOME_DIRECTION: Vec3 = [1, -1, 0.7];

export const HOME_ANGLES: ViewAngles = (() => {
  const dir = vec3.normalize(HOME_DIRECTION);
  return { azimuth: Math.atan2(dir[1], dir[0]), polar: Math.acos(dir[2]) };
})();

/** Wrap an angle into [-PI, PI) */
export const wrapAngle = (a: number): number =>
  a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

/**
 * The azimuth equivalent to `desired` that is closest to `current`, so a view
 * change turns the short way round instead of spinning through a full turn
 */
export const nearestAzimuth = (current: number, desired: number): number =>
  current + wrapAngle(desired - current);

/** Camera axes for orbit angles: screen right, screen up, and view direction */
export const cameraBasis = (
  azimuth: number,
  polar: number,
): { right: Vec3; up: Vec3; forward: Vec3 } => {
  const s = Math.sin(polar);
  const forward: Vec3 = [
    -s * Math.cos(azimuth),
    -s * Math.sin(azimuth),
    -Math.cos(polar),
  ];
  // Right is horizontal, so it stays defined even looking straight down
  const right = vec3.normalize([-Math.sin(azimuth), Math.cos(azimuth), 0]);
  const up = vec3.cross(right, forward);
  return {
    right: [right[0], right[1], right[2]],
    up: [up[0], up[1], up[2]],
    forward,
  };
};

/** The axis view the camera is looking from, within `tolerance` radians */
export const currentAxisView = (
  azimuth: number,
  polar: number,
  tolerance = 0.01,
): AxisView | null => {
  for (const [name, view] of Object.entries(AXIS_VIEWS) as [
    AxisView,
    ViewAngles,
  ][]) {
    const polarClose = Math.abs(polar - view.polar) < tolerance;
    // Azimuth does not matter when looking straight up or down, only roll does
    const azimuthClose =
      Math.abs(wrapAngle(azimuth - view.azimuth)) < tolerance;
    if (polarClose && azimuthClose) return name;
  }
  return null;
};

/** A world axis direction, as drawn on the gizmo */
export interface GizmoAxis {
  /** Which view clicking it moves to: looking from this side of the model */
  view: AxisView;
  axis: "x" | "y" | "z";
  positive: boolean;
  /** Projected position, in units of the gizmo radius, screen y up */
  x: number;
  y: number;
  /** Positive when the axis points away from the viewer */
  depth: number;
}

const GIZMO_AXES: { view: AxisView; axis: "x" | "y" | "z"; dir: Vec3 }[] = [
  { view: "right", axis: "x", dir: [1, 0, 0] },
  { view: "left", axis: "x", dir: [-1, 0, 0] },
  { view: "back", axis: "y", dir: [0, 1, 0] },
  { view: "front", axis: "y", dir: [0, -1, 0] },
  { view: "top", axis: "z", dir: [0, 0, 1] },
  { view: "bottom", axis: "z", dir: [0, 0, -1] },
];

/**
 * The six axis ends projected for the gizmo, farthest first so drawing them in
 * order layers the nearer ones on top
 */
export const gizmoAxes = (azimuth: number, polar: number): GizmoAxis[] => {
  const { right, up, forward } = cameraBasis(azimuth, polar);
  return GIZMO_AXES.map(({ view, axis, dir }) => ({
    view,
    axis,
    positive: dir[0] + dir[1] + dir[2] > 0,
    x: vec3.dot(dir, right),
    y: vec3.dot(dir, up),
    depth: vec3.dot(dir, forward),
  })).sort((a, b) => b.depth - a.depth);
};

/**
 * Where to put the camera to fit an axis-aligned box in view from the given
 * angles: the box center as the orbit target, and the eye distance at which
 * the box's outline fills the frame with `margin` to spare. In perspective the
 * nearest corner sits closer than the target, so the distance grows by its
 * depth to keep that corner from swelling past the edge
 */
export const fitView = (
  min: Vec3,
  max: Vec3,
  angles: ViewAngles,
  aspect: number,
  fovYRadians: number,
  orthographic: boolean,
  margin = 1.2,
): { target: Vec3; distance: number } => {
  const target: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const { right, up, forward } = cameraBasis(angles.azimuth, angles.polar);
  let halfWidth = 0;
  let halfHeight = 0;
  let nearest = 0;
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) {
        const d: Vec3 = [x - target[0], y - target[1], z - target[2]];
        halfWidth = Math.max(halfWidth, Math.abs(vec3.dot(d, right)));
        halfHeight = Math.max(halfHeight, Math.abs(vec3.dot(d, up)));
        nearest = Math.max(nearest, -vec3.dot(d, forward));
      }
  const span = Math.max(halfHeight, halfWidth / Math.max(aspect, 1e-6), 1e-3);
  const distance = (span * margin) / Math.tan(fovYRadians / 2);
  return { target, distance: orthographic ? distance : distance + nearest };
};

/** Degrees each orbit key turns the view */
export const ORBIT_STEP = (15 * Math.PI) / 180;

/** Zoom factor per zoom key press */
const ZOOM_STEP = 1.25;

/** A view change the keyboard can ask for */
export type ViewKeyAction =
  | { kind: "view"; view: ViewName }
  | { kind: "opposite" }
  | { kind: "frame" }
  | { kind: "projection" }
  | { kind: "orbit"; azimuth: number; polar: number }
  | { kind: "zoom"; factor: number };

/**
 * The conventional numpad view keys, with the number row working the same
 * way for keyboards without a numpad:
 *
 * - 1 front, 3 right, 7 top, with Ctrl for the opposite side; 9 flips to the
 *   opposite side; 0 returns to the home view
 * - 4 and 6 orbit left and right, 8 and 2 orbit up and down, in 15 degree
 *   steps; the arrow keys orbit too
 * - plus and minus zoom; 5 toggles orthographic; period or Home frames the
 *   model
 */
export const viewKeyAction = (e: {
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): ViewKeyAction | null => {
  if (e.altKey || e.metaKey) return null;
  const digit = /^(?:Numpad|Digit)([0-9])$/.exec(e.code)?.[1];
  const pick = (view: AxisView): ViewKeyAction => ({
    kind: "view",
    view: e.ctrlKey ? OPPOSITE[view] : view,
  });
  if (digit === "1") return pick("front");
  if (digit === "3") return pick("right");
  if (digit === "7") return pick("top");
  // Ctrl with anything else is left to the browser (copy, zoom, tabs)
  if (e.ctrlKey) return null;
  const orbit = (azimuth: number, polar: number): ViewKeyAction => ({
    kind: "orbit",
    azimuth,
    polar,
  });
  if (digit === "9") return { kind: "opposite" };
  if (digit === "5") return { kind: "projection" };
  if (digit === "0") return { kind: "view", view: "home" };
  if (digit === "4" || e.code === "ArrowLeft") return orbit(-ORBIT_STEP, 0);
  if (digit === "6" || e.code === "ArrowRight") return orbit(ORBIT_STEP, 0);
  if (digit === "8" || e.code === "ArrowUp") return orbit(0, -ORBIT_STEP);
  if (digit === "2" || e.code === "ArrowDown") return orbit(0, ORBIT_STEP);
  if (e.code === "NumpadAdd" || e.code === "Equal")
    return { kind: "zoom", factor: 1 / ZOOM_STEP };
  if (e.code === "NumpadSubtract" || e.code === "Minus")
    return { kind: "zoom", factor: ZOOM_STEP };
  if (e.code === "NumpadDecimal" || e.code === "Period" || e.code === "Home")
    return { kind: "frame" };
  return null;
};

/** Key hints for each view action, as shown in tooltips and the palette */
export const VIEW_KEYS = {
  front: "1",
  back: "Ctrl 1",
  right: "3",
  left: "Ctrl 3",
  top: "7",
  bottom: "Ctrl 7",
  home: "0",
  flip: "9",
  frame: "Home",
  projection: "5",
} as const;
