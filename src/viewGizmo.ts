import { VIEW_KEYS, VIEW_LABELS, gizmoAxes } from "./gpu/views";

import type { AxisView } from "./gpu/views";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Distance from the gizmo center to an axis end, in viewBox units */
const AXIS_LENGTH = 32;

/** Radius of the labelled positive axis ends and the plain negative ones */
const POSITIVE_RADIUS = 9;
const NEGATIVE_RADIUS = 7;

/** Pointer travel, in pixels, past which a press on the gizmo is a drag */
const DRAG_THRESHOLD = 3;

interface AxisNodes {
  group: SVGGElement;
  line: SVGLineElement | null;
  ball: SVGCircleElement;
  label: SVGTextElement | null;
}

const create = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

/**
 * The navigation gizmo: the world axes as seen from the current camera, drawn
 * in the corner of the viewport. Clicking an axis end looks at the model from
 * that side, and dragging the gizmo orbits the camera. It is plain SVG updated
 * from the render loop, so following the camera costs no React renders
 */
export class ViewGizmo {
  readonly el: SVGSVGElement;
  private readonly axes = new Map<AxisView, AxisNodes>();
  private lastKey = "";

  constructor(
    onPick: (view: AxisView) => void,
    onOrbit: (dx: number, dy: number) => void,
  ) {
    const svg = create("svg", {
      viewBox: "-50 -50 100 100",
      class: "view-gizmo",
      role: "group",
      // One tab stop: once focused, the view keys and arrow keys drive it
      tabindex: "0",
      "aria-label":
        "View navigation. Click an axis to look from that side, or drag to orbit. With focus here, the arrow keys orbit and the number keys pick a view",
    });
    svg.appendChild(
      create("circle", { class: "view-gizmo-backdrop", r: "48" }),
    );

    for (const { view, axis, positive } of gizmoAxes(0, Math.PI / 2)) {
      const group = create("g", {
        class: `view-gizmo-axis axis-${axis}${positive ? "" : " negative"}`,
        "data-view": view,
      });
      const title = create("title");
      title.textContent = `View from ${VIEW_LABELS[view].toLowerCase()} (${positive ? "+" : "-"}${axis.toUpperCase()}) · ${VIEW_KEYS[view]}`;
      group.appendChild(title);
      const line = positive ? create("line", { x1: "0", y1: "0" }) : null;
      if (line) svg.appendChild(line);
      line?.setAttribute("class", `view-gizmo-line axis-${axis}`);
      const ball = create("circle", {
        r: String(positive ? POSITIVE_RADIUS : NEGATIVE_RADIUS),
      });
      group.appendChild(ball);
      const label = positive
        ? create("text", {
            "text-anchor": "middle",
            "dominant-baseline": "central",
          })
        : null;
      if (label) {
        label.textContent = axis.toUpperCase();
        group.appendChild(label);
      }
      svg.appendChild(group);
      this.axes.set(view, { group, line, ball, label });
    }

    this.el = svg;
    this.attachPointer(onPick, onOrbit);
  }

  /** Redraw for the camera's current angles */
  update(azimuth: number, polar: number): void {
    // The render loop calls this every frame; skip the DOM when nothing moved
    const key = `${azimuth.toFixed(4)},${polar.toFixed(4)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    // Farthest first, so appending in order layers nearer axes on top
    for (const a of gizmoAxes(azimuth, polar)) {
      const nodes = this.axes.get(a.view);
      if (!nodes) continue;
      const x = (a.x * AXIS_LENGTH).toFixed(2);
      // SVG y grows downward, the camera's up does not
      const y = (-a.y * AXIS_LENGTH).toFixed(2);
      nodes.ball.setAttribute("cx", x);
      nodes.ball.setAttribute("cy", y);
      nodes.label?.setAttribute("x", x);
      nodes.label?.setAttribute("y", y);
      if (nodes.line) {
        nodes.line.setAttribute("x2", x);
        nodes.line.setAttribute("y2", y);
        this.el.appendChild(nodes.line);
      }
      // Axes pointing away read as further back
      nodes.group.style.opacity = a.depth > 0.05 ? "0.72" : "1";
      this.el.appendChild(nodes.group);
    }
  }

  private attachPointer(
    onPick: (view: AxisView) => void,
    onOrbit: (dx: number, dy: number) => void,
  ): void {
    const svg = this.el;
    let press: {
      id: number;
      x: number;
      y: number;
      view: AxisView | null;
      dragging: boolean;
    } | null = null;

    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const target = (e.target as Element).closest("[data-view]");
      press = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        view: (target?.getAttribute("data-view") as AxisView | null) ?? null,
        dragging: false,
      };
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    svg.addEventListener("pointermove", (e) => {
      if (!press || e.pointerId !== press.id) return;
      const dx = e.clientX - press.x;
      const dy = e.clientY - press.y;
      if (!press.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      press.dragging = true;
      press.x = e.clientX;
      press.y = e.clientY;
      onOrbit(dx, dy);
    });

    const end = (e: PointerEvent): void => {
      if (!press || e.pointerId !== press.id) return;
      const { view, dragging } = press;
      press = null;
      if (svg.hasPointerCapture(e.pointerId))
        svg.releasePointerCapture(e.pointerId);
      if (!dragging && view && e.type === "pointerup") onPick(view);
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
  }
}
