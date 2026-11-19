import { meshBounds } from "./facet";
import { frameSphere, viewProjection } from "./gpu/camera";
import { OrbitState } from "./gpu/orbit";
import { paletteFor } from "./gpu/palette";
import { captureSize, isUniform } from "./gpu/readback";
import { rendererOrder } from "./gpu/rendererPreference";
import { createWebGlBackend } from "./gpu/webglBackend";
import { createWebGpuBackend } from "./gpu/webgpuBackend";

import type { Mesh } from "./facet";
import type { FrameParams, RenderBackend, RendererKind } from "./gpu/backend";
import type { BoundingSphere, Vec3 } from "./gpu/camera";
import type { Palette } from "./gpu/palette";
import type { RendererPreference } from "./gpu/rendererPreference";
import type { Theme } from "./theme";

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
    for (const kind of rendererOrder(this.preference)) {
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
    const { min, max } = meshBounds(mesh);
    // Circumscribing sphere of the AABB: center at the midpoint, radius the half-diagonal
    const sphere: BoundingSphere = {
      center: [
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        (min[2] + max[2]) / 2,
      ],
      radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
    };
    // frameSphere owns the framing constants (direction, distance, near, far)
    const { eye, target, near, far } = frameSphere(sphere);
    this.near = near;
    this.far = far;

    // A fresh orbit state resets to the canonical framing direction (1, -1, 0.7);
    // recenter on the model and dolly out to the framing distance
    const orbit = new OrbitState();
    orbit.target = target;
    const distance = Math.hypot(
      eye[0] - target[0],
      eye[1] - target[1],
      eye[2] - target[2],
    );
    orbit.dolly(distance - orbit.targetRadius);
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
    return {
      viewProj: viewProjection({
        eye: orbit.eye(),
        target: orbit.target,
        up: UP,
        fovYRadians: FOV_Y,
        aspect,
        near: this.near,
        far: this.far,
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
      e.preventDefault();
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!dragging || !this.orbit) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (dragging === "orbit") {
        this.orbit.rotate(-dx * ORBIT_SPEED, dy * ORBIT_SPEED);
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

  /** Release GPU resources, listeners, and the render loop. */
  dispose(): void {
    this.disposed = true;
    this.teardown();
    this.notice?.remove();
  }
}
