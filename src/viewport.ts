import tgpu from "typegpu";

import { meshBounds } from "./facet";
import { frameSphere, viewProjection } from "./gpu/camera";
import { acquireDevice } from "./gpu/device";
import { GridPipeline } from "./gpu/gridPipeline";
import { MeshPipeline } from "./gpu/meshPipeline";
import { OrbitState } from "./gpu/orbit";
import { paletteFor } from "./gpu/palette";
import {
  alignedBytesPerRow,
  captureSize,
  isUniform,
  unpackPixels,
} from "./gpu/readback";

import type { TgpuRoot } from "typegpu";
import type { Mesh } from "./facet";
import type { BoundingSphere, Vec3 } from "./gpu/camera";
import type { Palette } from "./gpu/palette";
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
  "This 3D preview needs WebGPU. Use a current version of Chrome, Edge, Safari, or Firefox.";

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
 * A Z-up WebGPU viewport that renders Facet meshes with flat, faceted shading
 * on a TypeGPU stack. The constructor is synchronous; device acquisition and
 * GPU setup run asynchronously, and calls that arrive first are queued and
 * replayed once the viewport is ready. When WebGPU is unavailable a themed
 * notice replaces the canvas and the public methods become no-ops.
 */
export class Viewport {
  private readonly container: HTMLElement;
  private theme: Theme;
  /** Cached palette for the active theme, recomputed only on theme change. */
  private palette: Palette;

  private canvas: HTMLCanvasElement | null = null;
  private root: TgpuRoot | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = "bgra8unorm";
  private depthFormat: GPUTextureFormat = "depth24plus";
  private depthTexture: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;
  private mesh: MeshPipeline | null = null;
  private grid: GridPipeline | null = null;
  private orbit: OrbitState | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private notice: HTMLElement | null = null;

  private readonly pending: Array<() => void> = [];
  private ready = false;
  private absent = false;
  private disposed = false;
  private hasFramed = false;
  private rafHandle = 0;

  private width = 1;
  private height = 1;
  private near = 0.1;
  private far = 5000;

  constructor(container: HTMLElement, theme: Theme) {
    this.container = container;
    this.theme = theme;
    this.palette = paletteFor(theme);
    void this.init();
  }

  private async init(): Promise<void> {
    const device = await acquireDevice();
    if (this.disposed) {
      device?.destroy();
      return;
    }
    if (!device) {
      this.showNotice();
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    this.container.appendChild(canvas);
    this.canvas = canvas;

    const root = tgpu.initFromDevice({ device });
    this.root = root;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.format = format;
    this.context = root.configureContext({ canvas, format });

    this.mesh = new MeshPipeline(root, format, this.depthFormat);
    this.grid = new GridPipeline(root, format, this.depthFormat);
    this.grid.setColor(this.palette.grid);
    this.orbit = new OrbitState();

    this.measure();
    this.allocateDepth();
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);
    this.attachPointer(canvas);

    this.ready = true;
    const queued = this.pending.splice(0, this.pending.length);
    for (const replay of queued) replay();

    this.frame();
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
    if (!this.mesh || mesh.triangleCount === 0) return;
    this.mesh.setMesh(mesh.positions, mesh.normals, mesh.triangleCount);
    if (reframe || !this.hasFramed) {
      this.frameMesh(mesh);
      this.hasFramed = true;
    }
  }

  /** Recolor background and grid for the active theme. */
  setTheme(theme: Theme): void {
    this.theme = theme;
    this.palette = paletteFor(theme);
    if (this.absent) {
      this.styleNotice();
      return;
    }
    if (!this.ready) {
      this.pending.push(() => this.setTheme(theme));
      return;
    }
    this.grid?.setColor(this.palette.grid);
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

  private allocateDepth(): void {
    if (!this.root || !this.canvas) return;
    this.depthTexture?.destroy();
    this.depthTexture = this.root.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTexture.createView();
  }

  private onResize(): void {
    if (this.disposed || !this.ready) return;
    this.measure();
    this.allocateDepth();
  }

  private frame = (): void => {
    if (this.disposed) return;
    this.rafHandle = requestAnimationFrame(this.frame);
    this.render();
  };

  /**
   * Capture the current view as a PNG, for the AI render-and-critique loop (hand
   * the result to a vision model). Resolves null when there is nothing to
   * capture (no WebGPU device, no model yet) or the readback fails or is blank,
   * so the critique simply does not run.
   *
   * The frame is rendered into an offscreen texture and read back with
   * `copyTextureToBuffer`, never from the on-screen canvas: reading a WebGPU
   * canvas (`toDataURL`) depends on the browser compositing the swapchain into
   * a readable surface, which some GPU stacks do not do (Linux + Vulkan returns
   * a fully transparent image), and a hidden or collapsed viewport (the phone
   * layout's code tab) has a 1x1 canvas. The offscreen frame uses the on-screen
   * camera at a fixed size, so it matches what the user sees
   */
  async capture(): Promise<ViewportCapture | null> {
    if (this.disposed || !this.ready || !this.hasFramed) return null;
    const root = this.root;
    if (!root) return null;

    const { width, height } = captureSize(
      this.width,
      this.height,
      CAPTURE_LONG_EDGE,
    );
    const device = root.device;
    const bytesPerRow = alignedBytesPerRow(width);
    let color: GPUTexture | null = null;
    let depth: GPUTexture | null = null;
    let buffer: GPUBuffer | null = null;

    try {
      color = device.createTexture({
        size: [width, height],
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      depth = device.createTexture({
        size: [width, height],
        format: this.depthFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      buffer = device.createBuffer({
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      if (!this.draw(color.createView(), depth.createView(), width / height)) {
        return null;
      }

      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: color },
        { buffer, bytesPerRow, rowsPerImage: height },
        [width, height],
      );
      device.queue.submit([encoder.finish()]);

      await buffer.mapAsync(GPUMapMode.READ);
      if (this.disposed) return null;
      const pixels = unpackPixels(
        new Uint8Array(buffer.getMappedRange()),
        width,
        height,
        bytesPerRow,
        this.format,
      );
      buffer.unmap();

      // A frame that drew nothing is not worth critiquing
      if (isUniform(pixels)) return null;

      const data = encodePng(pixels, width, height);
      return data ? { mediaType: "image/png", data } : null;
    } catch {
      return null;
    } finally {
      color?.destroy();
      depth?.destroy();
      buffer?.destroy();
    }
  }

  /** Draw the on-screen frame to the canvas. */
  private render(): void {
    const context = this.context;
    const depthView = this.depthView;
    if (!context || !depthView) return;
    this.draw(context, depthView, this.width / Math.max(this.height, 1));
  }

  /**
   * Draw the scene into a color target with the current camera. Returns false
   * when the viewport is not set up (nothing was drawn)
   */
  private draw(
    target: GPUCanvasContext | GPUTextureView,
    depthView: GPUTextureView,
    aspect: number,
  ): boolean {
    if (this.disposed) return false;
    const { root, mesh, grid, orbit } = this;
    if (!root || !mesh || !grid || !orbit) return false;

    orbit.update();
    const viewProj = viewProjection({
      eye: orbit.eye(),
      target: orbit.target,
      up: UP,
      fovYRadians: FOV_Y,
      aspect,
      near: this.near,
      far: this.far,
    });
    mesh.writeUniforms({
      viewProj,
      lightDir: LIGHT_DIR,
      baseColor: this.palette.baseColor,
    });

    const bg = this.palette.background;
    const encoder = root["~unstable"].createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target,
          clearValue: [bg[0], bg[1], bg[2], bg[3]],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    grid.render(pass, mesh.bindGroup);
    mesh.render(pass);
    pass.end();
    encoder.submit();
    return true;
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
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.resizeObserver?.disconnect();
    this.mesh?.dispose();
    this.grid?.dispose();
    this.depthTexture?.destroy();
    this.root?.destroy();
    this.canvas?.remove();
    this.notice?.remove();
  }
}
