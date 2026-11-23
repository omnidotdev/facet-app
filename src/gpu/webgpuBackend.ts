import tgpu from "typegpu";

import { acquireDevice } from "./device";
import { GridPipeline } from "./gridPipeline";
import { MeshPipeline } from "./meshPipeline";
import { alignedBytesPerRow, unpackPixels } from "./readback";

import type { TgpuRoot } from "typegpu";
import type { FrameParams, RenderBackend } from "./backend";

const DEPTH_FORMAT: GPUTextureFormat = "depth24plus";

/** The primary renderer: WebGPU through TypeGPU */
class WebGpuBackend implements RenderBackend {
  readonly kind = "webgpu" as const;

  private readonly root: TgpuRoot;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly mesh: MeshPipeline;
  private readonly grid: GridPipeline;
  private depthTexture: GPUTexture | null = null;
  private depthView: GPUTextureView | null = null;

  constructor(canvas: HTMLCanvasElement, device: GPUDevice) {
    this.root = tgpu.initFromDevice({ device });
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context = this.root.configureContext({ canvas, format: this.format });
    this.mesh = new MeshPipeline(this.root, this.format, DEPTH_FORMAT);
    this.grid = new GridPipeline(this.root, this.format, DEPTH_FORMAT);
    this.resize(canvas.width, canvas.height);
  }

  resize(width: number, height: number): void {
    this.depthTexture?.destroy();
    this.depthTexture = this.root.device.createTexture({
      size: [Math.max(width, 1), Math.max(height, 1)],
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTexture.createView();
  }

  setMesh(
    positions: Float32Array,
    normals: Float32Array,
    edges: Float32Array,
    triangleCount: number,
  ): void {
    this.mesh.setMesh(positions, normals, edges, triangleCount);
  }

  setEdges(edges: Float32Array): void {
    this.mesh.setEdges(edges);
  }

  draw(frame: FrameParams): void {
    if (!this.depthView) return;
    this.drawInto(this.context, this.depthView, frame);
  }

  /**
   * Render into an offscreen texture and read it back with
   * `copyTextureToBuffer`, never from the on-screen canvas: reading a WebGPU
   * canvas (`toDataURL`) depends on the browser compositing the swapchain into
   * a readable surface, which some GPU stacks do not do (Linux + Vulkan returns
   * a fully transparent image)
   */
  async capture(
    width: number,
    height: number,
    frame: FrameParams,
  ): Promise<Uint8ClampedArray<ArrayBuffer> | null> {
    const device = this.root.device;
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
        format: DEPTH_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      buffer = device.createBuffer({
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      this.drawInto(color.createView(), depth.createView(), frame);

      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: color },
        { buffer, bytesPerRow, rowsPerImage: height },
        [width, height],
      );
      device.queue.submit([encoder.finish()]);

      await buffer.mapAsync(GPUMapMode.READ);
      const pixels = unpackPixels(
        new Uint8Array(buffer.getMappedRange()),
        width,
        height,
        bytesPerRow,
        this.format,
      );
      buffer.unmap();
      return pixels;
    } catch {
      return null;
    } finally {
      color?.destroy();
      depth?.destroy();
      buffer?.destroy();
    }
  }

  private drawInto(
    target: GPUCanvasContext | GPUTextureView,
    depthView: GPUTextureView,
    frame: FrameParams,
  ): void {
    this.mesh.writeUniforms({
      viewProj: frame.viewProj,
      lightDir: frame.lightDir,
      baseColor: frame.baseColor,
      style: frame.style,
      edgeColor: frame.edgeColor,
    });
    this.grid.setColor(frame.grid);

    const bg = frame.background;
    const encoder = this.root["~unstable"].createCommandEncoder();
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
    this.grid.render(pass, this.mesh.bindGroup);
    // A see-through mode (fill opacity below 1) skips depth writes
    this.mesh.render(pass, frame.style[0] < 1);
    pass.end();
    encoder.submit();
  }

  dispose(): void {
    this.mesh.dispose();
    this.grid.dispose();
    this.depthTexture?.destroy();
    this.root.destroy();
  }
}

/**
 * Set up WebGPU on the canvas, or null when the browser has no usable WebGPU
 * adapter (the caller then tries WebGL on a fresh canvas, since a canvas that
 * handed out a WebGPU context can not give a WebGL one)
 */
export const createWebGpuBackend = async (
  canvas: HTMLCanvasElement,
): Promise<RenderBackend | null> => {
  const device = await acquireDevice();
  if (!device) return null;
  try {
    return new WebGpuBackend(canvas, device);
  } catch {
    device.destroy();
    return null;
  }
};
