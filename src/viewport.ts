import { meshBounds } from "./facet";
import { frameSphere, viewProjection } from "./gpu/camera";
import { OrbitState } from "./gpu/orbit";
import { paletteFor } from "./gpu/palette";
import { captureSize, isUniform } from "./gpu/readback";
import { isDesktopLinux, rendererOrder } from "./gpu/rendererPreference";
import {
  AXIS_VIEWS,
  HOME_ANGLES,
  OPPOSITE,
  currentAxisView,
  fitView,
  viewKeyAction,
} from "./gpu/views";
import { createWebGlBackend } from "./gpu/webglBackend";
import { createWebGpuBackend } from "./gpu/webgpuBackend";
import { ViewGizmo } from "./viewGizmo";

import type { Mesh } from "./facet";
import type { FrameParams, RenderBackend, RendererKind } from "./gpu/backend";
import type { BoundingSphere, Vec3 } from "./gpu/camera";
import type { Palette } from "./gpu/palette";
import type { RendererPreference } from "./gpu/rendererPreference";
import type { ViewAngles, ViewName } from "./gpu/views";
import type { Theme } from "./theme";

/** How the viewport projects the scene */
export type Projection = "perspective" | "orthographic";

/** `navigator` with the Chromium-only User-Agent Client Hints */
type PlatformNavigator = Navigator & { userAgentData?: { platform?: string } };

/** World up axis. Z-up, matching the modeling convention and the orbit state. */
const UP: Vec3 = [0, 0, 1];

/** Vertical field of view, matching the old 45 degree perspective camera. */
const FOV_Y = (45 * Math.PI) / 180;

/** Key light direction, normalized in the shader. Mirrors the old directional light at (60, -40, 90). */
const LIGHT_DIR: readonly [number, number, number] = [60, -40, 90];

/** Radians of orbit per pixel dragged. */
const ORBIT_SPEED = 0.006;

/** Fraction of the orbit radius panned per pixel dragged. */
const PAN_SPEED = 0.0016;

/** Dolly response per wheel delta unit. */
const WHEEL_SPEED = 0.0012;

const NOTICE_COPY =
  "This browser has 3D graphics (WebGPU and WebGL) turned off, so the preview can't show. You can still edit code and export files.";

/**
 * Long edge of an AI critique capture, in pixels. Fixed (rather than the
 * on-screen canvas size) so the vision model sees a predictable image at a
 * predictable cost, and so capture works when the viewport is hidden
 */
const CAPTURE_LONG_EDGE = 768;

/** A rendered view, encoded for the AI render critique */
export interface ViewportCapture {
  mediaType: "image/png";
  /** Base64 PNG bytes, no `data:` prefix */
  data: string;
}

const toCss = (c: readonly [number, number, number, number]): string =>
  `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;

/**
 * Encode RGBA pixels as base64 PNG (no `data:` prefix) through a 2D canvas, or
 * null when the browser can not encode
 */
const encodePng = (
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): string | null => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  const url = canvas.toDataURL("image/png");
  const comma = url.indexOf(",");
  return comma > 0 && url.startsWith("data:image/png")
    ? url.slice(comma + 1)
    : null;
};

/** Circumscribing sphere of a mesh's bounding box */
const boundingSphere = (mesh: Mesh): BoundingSphere => {
  const { min, max } = meshBounds(mesh);
  return {
    center: [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ],
    radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
  };
};

/**
 * A Z-up viewport that renders Facet meshes with flat, faceted shading. It
 * owns the camera, input, and framing, and draws through a {@link RenderBackend}:
 * WebGPU when the browser has it, otherwise the WebGL 2 compatibility path.
 * The constructor is synchronous; backend setup runs asynchronously, and calls
 * that arrive first are queued and replayed once the viewport is ready. When
 * neither API is available a themed notice replaces the canvas and the public
 * methods become no-ops.
 */
export class Viewport {
  private readonly container: HTMLElement;
  private theme: Theme;
  /** Cached palette for the active theme, recomputed only on theme change. */
  private palette: Palette;
  private preference: RendererPreference;
  private readonly onRenderer: (kind: RendererKind | null) => void;

  private canvas: HTMLCanvasElement | null = null;
  private backend: RenderBackend | null = null;
  private orbit: OrbitState | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private notice: HTMLElement | null = null;
  /** The solid on screen, re-uploaded when the renderer is switched */
  private lastMesh: Mesh | null = null;

  private readonly pending: Array<() => void> = [];
  private ready = false;
  private absent = false;
  private disposed = false;
  private hasFramed = false;
  private rafHandle = 0;
  /** Bumped per setup so a superseded async init does not attach */
  private generation = 0;

  private projection: Projection = "perspective";
  /**
   * Set when an axis view switched to orthographic on its own, so orbiting
   * away returns to perspective. An explicit toggle clears it
   */
  private autoOrthographic = false;
  private gizmo: ViewGizmo | null = null;
  /** Whether the pointer is over the viewport, which scopes the view keys */
  private hovering = false;

  /** Told whenever the projection changes, so the UI can show it */
  onProjectionChange: (projection: Projection) => void = () => {};

  private width = 1;
  private height = 1;
  private near = 0.1;
  private far = 5000;

  /**
   * @param container - Element the canvas (or notice) fills
   * @param theme - Initial color theme
   * @param preference - Which renderer to try first
   * @param onRenderer - Told which renderer is active once set up (null when
   *   neither is available), so the UI can show it
   */
  constructor(
    container: HTMLElement,
    theme: Theme,
    preference: RendererPreference = "auto",
    onRenderer: (kind: RendererKind | null) => void = () => {},
  ) {
    this.container = container;
    this.theme = theme;
    this.palette = paletteFor(theme);
    this.preference = preference;
    this.onRenderer = onRenderer;
    // Focusable, so the view keys work from the keyboard alone (Tab to the
    // view) as well as while the pointer is over it
    container.tabIndex = 0;
    container.setAttribute("role", "application");
    container.setAttribute(
      "aria-label",
      "3D view. Number keys change the view: 1 front, 3 right, 7 top, Ctrl for the opposite side, 0 home, arrows orbit, plus and minus zoom, 5 orthographic, Home frames the model",
    );
    container.addEventListener("pointerenter", this.onPointerEnter);
    container.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("keydown", this.onKeyDown);
    void this.init();
  }

  /** The renderer currently drawing, or null before setup or when none is available */
  get renderer(): RendererKind | null {
    return this.backend?.kind ?? null;
  }

  private createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    return canvas;
  }

  private async init(): Promise<void> {
    const generation = ++this.generation;
    for (const kind of rendererOrder(
      this.preference,
      isDesktopLinux(navigator as PlatformNavigator),
    )) {
      // A fresh canvas per attempt: one that handed out a WebGPU context can
      // not give a WebGL one
      const canvas = this.createCanvas();
      this.canvas = canvas;
      this.measure();
      const backend =
        kind === "webgpu"
          ? await createWebGpuBackend(canvas)
          : createWebGlBackend(canvas);
      if (this.disposed || generation !== this.generation) {
        backend?.dispose();
        return;
      }
      if (backend) {
        this.attach(canvas, backend);
        return;
      }
    }
    this.canvas = null;
    this.showNotice();
    this.onRenderer(null);
  }

  private attach(canvas: HTMLCanvasElement, backend: RenderBackend): void {
    this.container.appendChild(canvas);
    this.backend = backend;
    this.orbit ??= new OrbitState();

    this.measure();
    backend.resize(canvas.width, canvas.height);
    if (this.lastMesh) {
      const m = this.lastMesh;
      backend.setMesh(m.positions, m.normals, m.triangleCount);
    }
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);
    this.attachPointer(canvas);

    this.ready = true;
    this.onRenderer(backend.kind);
    const queued = this.pending.splice(0, this.pending.length);
    for (const replay of queued) replay();

    this.frame();
  }

  /**
   * Switch renderer preference, rebuilding the canvas and backend while
   * keeping the solid and the camera where they are
   */
  setRendererPreference(preference: RendererPreference): void {
    if (this.disposed || preference === this.preference) return;
    this.preference = preference;
    this.teardown();
    this.absent = false;
    this.notice?.remove();
    this.notice = null;
    void this.init();
  }

  /** Release the backend, canvas, and loop, keeping camera and model state */
  private teardown(): void {
    this.ready = false;
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.backend?.dispose();
    this.backend = null;
    this.canvas?.remove();
    this.canvas = null;
  }

  /**
   * Replace the displayed solid. The camera only refits when `reframe` is set
   * (initial load, example switch), so editing a parameter grows the model in
   * place instead of jumping the view on every recompute. The first mesh always
   * frames, since there is no prior fit to preserve.
   */
  setMesh(mesh: Mesh, reframe = false): void {
    if (this.absent) return;
    if (!this.ready) {
      this.pending.push(() => this.setMesh(mesh, reframe));
      return;
    }
    // An empty recompute keeps the last solid on screen rather than blanking it
    if (!this.backend || mesh.triangleCount === 0) return;
    this.backend.setMesh(mesh.positions, mesh.normals, mesh.triangleCount);
    this.lastMesh = mesh;
    if (reframe || !this.hasFramed) {
      this.frameMesh(mesh);
      this.hasFramed = true;
    }
  }

  /** Recolor background and grid for the active theme. */
  setTheme(theme: Theme): void {
    this.theme = theme;
    this.palette = paletteFor(theme);
    this.styleNotice();
  }
  /** Point the camera at the model and pull back to fit it, jumping the view once. */
  private frameMesh(mesh: Mesh): void {
    // A fresh orbit state starts at the home view; fit the model there and
    // jump straight to it, the same framing the Home view eases to later
    const orbit = new OrbitState();
    const { target, distance } = this.fit(mesh, HOME_ANGLES);
    orbit.target = target;
    orbit.zoomTo(distance);
    orbit.settle();
    this.orbit = orbit;
  }

  private measure(): void {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = w;
    this.height = h;
    if (this.canvas) {
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(h * dpr));
    }
  }

  private onResize(): void {
    if (this.disposed || !this.ready || !this.canvas) return;
    this.measure();
    this.backend?.resize(this.canvas.width, this.canvas.height);
  }

  private frame = (): void => {
    if (this.disposed) return;
    this.rafHandle = requestAnimationFrame(this.frame);
    this.render();
  };

  /**
   * Capture the current view as a PNG, for the AI render-and-critique loop (hand
   * the result to a vision model). Resolves null when there is nothing to
   * capture (no renderer, no model yet) or the readback fails or is blank, so
   * the critique simply does not run.
   *
   * The backend renders the frame offscreen at a fixed size rather than reading
   * the on-screen canvas, so a hidden or collapsed viewport (the phone layout's
   * code tab, a 1x1 canvas) still captures, with the on-screen camera so it
   * matches what the user sees
   */
  async capture(): Promise<ViewportCapture | null> {
    if (this.disposed || !this.ready || !this.hasFramed) return null;
    const backend = this.backend;
    if (!backend) return null;

    const { width, height } = captureSize(
      this.width,
      this.height,
      CAPTURE_LONG_EDGE,
    );
    const frame = this.frameParams(width / height);
    if (!frame) return null;
    const pixels = await backend.capture(width, height, frame);
    if (this.disposed || !pixels) return null;
    // A frame that drew nothing is not worth critiquing
    if (isUniform(pixels)) return null;
    const data = encodePng(pixels, width, height);
    return data ? { mediaType: "image/png", data } : null;
  }

  /** Draw the on-screen frame to the canvas. */
  private render(): void {
    const frame = this.frameParams(this.width / Math.max(this.height, 1));
    if (frame) this.backend?.draw(frame);
  }

  /** The current camera and palette as backend frame parameters */
  private frameParams(aspect: number): FrameParams | null {
    const orbit = this.orbit;
    if (this.disposed || !orbit) return null;
    orbit.update();
    this.gizmo?.update(orbit.azimuth, orbit.polar);
    return {
      viewProj: viewProjection({
        eye: orbit.eye(),
        target: orbit.target,
        up: UP,
        fovYRadians: FOV_Y,
        aspect,
        near: this.near,
        far: this.far,
        orthographic: this.projection === "orthographic",
      }),
      lightDir: LIGHT_DIR,
      baseColor: this.palette.baseColor,
      background: this.palette.background,
      grid: this.palette.grid,
    };
  }

  private attachPointer(canvas: HTMLCanvasElement): void {
    let dragging: "orbit" | "pan" | null = null;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener("pointerdown", (e) => {
      const panning = e.button === 1 || e.button === 2 || e.shiftKey;
      dragging = panning ? "pan" : e.button === 0 ? "orbit" : null;
      if (!dragging) return;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      // The default is prevented below, so take keyboard focus by hand: after
      // clicking the view, its keys work even once the pointer leaves
      this.container.focus({ preventScroll: true });
      e.preventDefault();
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!dragging || !this.orbit) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (dragging === "orbit") {
        this.orbitBy(dx, dy);
      } else {
        const scale = this.orbit.radius * PAN_SPEED;
        this.orbit.pan(dx * scale, dy * scale);
      }
    });

    const end = (e: PointerEvent): void => {
      dragging = null;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.orbit) return;
        e.preventDefault();
        const factor = Math.exp(e.deltaY * WHEEL_SPEED);
        this.orbit.dolly(this.orbit.targetRadius * (factor - 1));
      },
      { passive: false },
    );
  }

  private showNotice(): void {
    this.absent = true;
    const el = document.createElement("div");
    el.textContent = NOTICE_COPY;
    this.notice = el;
    this.styleNotice();
    this.container.appendChild(el);
  }

  private styleNotice(): void {
    const el = this.notice;
    if (!el) return;
    const s = el.style;
    s.boxSizing = "border-box";
    s.width = "100%";
    s.height = "100%";
    s.display = "flex";
    s.alignItems = "center";
    s.justifyContent = "center";
    s.textAlign = "center";
    s.padding = "2rem";
    s.font = "500 0.95rem/1.5 system-ui, sans-serif";
    s.background = toCss(this.palette.background);
    s.color = this.theme === "dark" ? "#c9d3de" : "#3a3326";
  }

  /** Orbit by a pointer drag, leaving an automatic orthographic view */
  private orbitBy(dx: number, dy: number): void {
    this.orbitAngles(-dx * ORBIT_SPEED, dy * ORBIT_SPEED);
  }

  /** Orbit by angles, leaving an automatic orthographic view */
  private orbitAngles(azimuth: number, polar: number): void {
    if (!this.orbit) return;
    this.orbit.rotate(azimuth, polar);
    if (this.autoOrthographic) this.setProjection("perspective");
  }

  /**
   * Show the navigation gizmo in `mount`: the world axes as the camera sees
   * them. Clicking an axis looks from that side (clicking the side already in
   * view flips to the opposite one), and dragging it orbits
   */
  mountGizmo(mount: HTMLElement): void {
    if (this.gizmo) return;
    this.gizmo = new ViewGizmo(
      (view) => {
        const showing = this.orbit
          ? currentAxisView(this.orbit.targetAzimuth, this.orbit.targetPolar)
          : null;
        this.setView(showing === view ? OPPOSITE[view] : view);
      },
      (dx, dy) => this.orbitBy(dx, dy),
    );
    mount.appendChild(this.gizmo.el);
  }

  /**
   * Turn to a standard view. An axis view also switches to orthographic when
   * the view was in perspective, the usual auto-perspective behavior, and
   * orbiting away switches back. Home returns to the default three-quarter
   * view and fits the model
   */
  setView(view: ViewName): void {
    const orbit = this.orbit;
    if (!orbit) return;
    if (view === "home") {
      orbit.lookFrom(HOME_ANGLES.azimuth, HOME_ANGLES.polar);
      if (this.autoOrthographic) this.setProjection("perspective");
      this.frameModel();
      return;
    }
    const { azimuth, polar } = AXIS_VIEWS[view];
    orbit.lookFrom(azimuth, polar);
    if (this.projection === "perspective") {
      this.setProjection("orthographic");
      this.autoOrthographic = true;
    }
  }

  /** Look from the opposite side of the model */
  flipView(): void {
    const orbit = this.orbit;
    if (!orbit) return;
    const showing = currentAxisView(orbit.targetAzimuth, orbit.targetPolar);
    if (showing) {
      this.setView(OPPOSITE[showing]);
      return;
    }
    orbit.lookFrom(orbit.targetAzimuth + Math.PI, Math.PI - orbit.targetPolar);
  }

  /**
   * Recenter on the model and zoom so its outline fills the view from where
   * the camera is heading, keeping the view direction
   */
  frameModel(): void {
    const orbit = this.orbit;
    const mesh = this.lastMesh;
    if (!orbit || !mesh) return;
    const { target, distance } = this.fit(mesh, {
      azimuth: orbit.targetAzimuth,
      polar: orbit.targetPolar,
    });
    orbit.moveTarget(target);
    orbit.zoomTo(distance);
  }

  /**
   * The orbit target and distance that fit the model from the given angles,
   * also setting the depth range from the model's size
   */
  private fit(
    mesh: Mesh,
    angles: ViewAngles,
  ): { target: Vec3; distance: number } {
    const { near, far } = frameSphere(boundingSphere(mesh));
    this.near = near;
    this.far = far;
    const { min, max } = meshBounds(mesh);
    return fitView(
      min,
      max,
      angles,
      this.width / Math.max(this.height, 1),
      FOV_Y,
      this.projection === "orthographic",
    );
  }

  /** The projection in use */
  get currentProjection(): Projection {
    return this.projection;
  }

  /** Switch between perspective and orthographic */
  toggleProjection(): void {
    this.setProjection(
      this.projection === "perspective" ? "orthographic" : "perspective",
    );
  }

  private setProjection(projection: Projection): void {
    // Any explicit or automatic change settles the automatic state
    this.autoOrthographic = false;
    if (projection === this.projection) return;
    this.projection = projection;
    this.onProjectionChange(projection);
  }

  private onPointerEnter = (): void => {
    this.hovering = true;
  };

  private onPointerLeave = (): void => {
    this.hovering = false;
  };

  /**
   * The view keys, active while the pointer is over the viewport or keyboard
   * focus is in it (the view, the gizmo, or its buttons), so typing in the
   * editor or a field never moves the camera
   */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.orbit) return;
    const scope = this.container.parentElement ?? this.container;
    const focused = scope.contains(document.activeElement);
    if (!this.hovering && !focused) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest("input, textarea, select, [contenteditable], .cm-editor")
    )
      return;
    const action = viewKeyAction(e);
    if (!action) return;
    // Orbit and zoom keys may repeat while held; the view jumps should not
    if (e.repeat && action.kind !== "orbit" && action.kind !== "zoom") return;
    e.preventDefault();
    switch (action.kind) {
      case "view":
        this.setView(action.view);
        break;
      case "opposite":
        this.flipView();
        break;
      case "frame":
        this.frameModel();
        break;
      case "projection":
        this.toggleProjection();
        break;
      case "orbit":
        this.orbitAngles(action.azimuth, action.polar);
        break;
      case "zoom":
        this.orbit.zoomTo(this.orbit.targetRadius * action.factor);
        break;
    }
  };

  /** Release GPU resources, listeners, and the render loop. */
  dispose(): void {
    this.disposed = true;
    this.teardown();
    this.notice?.remove();
    this.gizmo?.el.remove();
    this.gizmo = null;
    this.container.removeEventListener("pointerenter", this.onPointerEnter);
    this.container.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("keydown", this.onKeyDown);
  }
}
