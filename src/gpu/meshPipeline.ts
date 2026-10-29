import tgpu from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";

import { SceneUniforms } from "./uniforms";

import type {
  TgpuBindGroup,
  TgpuBuffer,
  TgpuRenderPass,
  TgpuRenderPipeline,
  TgpuRoot,
  UniformFlag,
  VertexFlag,
} from "typegpu";

/**
 * Values written into the shared scene uniform each frame. The vectors accept
 * plain tuples (or a Float32Array for the matrix); TypeGPU serializes them
 * against the {@link SceneUniforms} layout.
 */
export interface SceneUniformValues {
  viewProj: Float32Array;
  lightDir: readonly [number, number, number];
  baseColor: readonly [number, number, number, number];
}

/** Shared bind group layout: the one uniform block both the mesh and grid shaders read. */
export const sceneLayout = tgpu.bindGroupLayout({
  scene: { uniform: SceneUniforms },
});

/** The grid pipeline reuses this bind group, so it is widened to the loose type. */
export type SceneBindGroup = TgpuBindGroup;

// Positions and normals ride in separate, tightly packed float32x3 buffers
// A loose array (disarray) keeps the 12-byte stride the mesh data already uses,
// unlike a std array of vec3f which would pad each vertex to 16 bytes
const positionLayout = tgpu.vertexLayout((n: number) =>
  d.disarrayOf(d.float32x3, n),
);
const normalLayout = tgpu.vertexLayout((n: number) =>
  d.disarrayOf(d.float32x3, n),
);

type MeshVertexSchema = ReturnType<typeof positionLayout.schemaForCount>;
type MeshVertexBuffer = TgpuBuffer<MeshVertexSchema> & VertexFlag;

const vertexMain = tgpu.vertexFn({
  in: { position: d.vec3f, normal: d.vec3f },
  out: { pos: d.builtin.position, worldNormal: d.vec3f },
})((input) => {
  "use gpu";
  return {
    pos: std.mul(sceneLayout.$.scene.viewProj, d.vec4f(input.position, 1)),
    // Flat normals are baked per face by the kernel, so pass them straight through
    worldNormal: input.normal,
  };
});

const fragmentMain = tgpu.fragmentFn({
  in: { worldNormal: d.vec3f },
  out: d.vec4f,
})((input) => {
  "use gpu";
  const scene = sceneLayout.$.scene;
  const n = std.normalize(input.worldNormal);
  const l = std.normalize(scene.lightDir);
  // Key directional light, matching the old MeshStandardMaterial key fill
  const key = std.max(std.dot(n, l), 0) * 1.1;
  // Hemisphere fill, Z-up: faces pointing at +Z catch the sky, -Z the ground
  const hemiFactor = n.z * 0.5 + 0.5;
  const hemi = std.mix(d.vec3f(0.38, 0.38, 0.36), d.vec3f(1, 1, 1), hemiFactor);
  const lighting = std.add(std.mul(hemi, 0.85), d.vec3f(key, key, key));
  const rgb = std.mul(scene.baseColor.xyz, lighting);
  return d.vec4f(rgb, 1);
});

/** Owns the render pipeline, scene uniform, and vertex buffers for the Facet solid. */
export class MeshPipeline {
  private readonly pipeline: TgpuRenderPipeline;
  private readonly uniforms: TgpuBuffer<typeof SceneUniforms> & UniformFlag;
  /** Shared so the grid pipeline can bind the same scene uniform. */
  readonly bindGroup: SceneBindGroup;

  private positions: MeshVertexBuffer | null = null;
  private normals: MeshVertexBuffer | null = null;
  private vertexCount = 0;
  /** High-water vertex count the current buffers can hold, so slider recomputes reuse them. */
  private capacity = 0;

  constructor(
    private readonly root: TgpuRoot,
    format: GPUTextureFormat,
    depthFormat: GPUTextureFormat,
  ) {
    this.uniforms = root.createBuffer(SceneUniforms).$usage("uniform");
    this.bindGroup = root.createBindGroup(sceneLayout, {
      scene: this.uniforms,
    });
    this.pipeline = root.createRenderPipeline({
      vertex: vertexMain,
      fragment: fragmentMain,
      attribs: {
        position: positionLayout.attrib,
        normal: normalLayout.attrib,
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: true,
        depthCompare: "less",
      },
      targets: { format },
    });
  }

  /**
   * Upload the vertex data. The buffers are reallocated only when the vertex
   * count grows past the current capacity; a recompute that fits (the common
   * slider-drag case) just rewrites the existing buffers, avoiding two GPU
   * alloc/free pairs per frame.
   */
  setMesh(
    positions: Float32Array,
    normals: Float32Array,
    triangleCount: number,
  ): void {
    const vertexCount = triangleCount * 3;
    if (!this.positions || !this.normals || vertexCount > this.capacity) {
      this.positions?.destroy();
      this.normals?.destroy();
      this.positions = this.root
        .createBuffer(positionLayout.schemaForCount(vertexCount))
        .$usage("vertex");
      this.normals = this.root
        .createBuffer(normalLayout.schemaForCount(vertexCount))
        .$usage("vertex");
      this.capacity = vertexCount;
    }

    // The DOM lib types a plain Float32Array as backed by ArrayBufferLike, but
    // writeBuffer wants an ArrayBuffer-backed view; kernel meshes are never shared
    const queue = this.root.device.queue;
    queue.writeBuffer(
      this.positions.buffer,
      0,
      positions as Float32Array<ArrayBuffer>,
    );
    queue.writeBuffer(
      this.normals.buffer,
      0,
      normals as Float32Array<ArrayBuffer>,
    );
    this.vertexCount = vertexCount;
  }

  /** Serialize the current frame's scene uniform. */
  writeUniforms(values: SceneUniformValues): void {
    this.uniforms.write({
      viewProj: values.viewProj,
      lightDir: values.lightDir,
      baseColor: values.baseColor,
    });
  }

  /** Record the mesh draw into an already-open render pass. */
  render(pass: TgpuRenderPass): void {
    if (!this.positions || !this.normals || this.vertexCount === 0) return;
    this.pipeline
      .with(positionLayout, this.positions)
      .with(normalLayout, this.normals)
      .with(this.bindGroup)
      .with(pass)
      .draw(this.vertexCount);
  }

  dispose(): void {
    this.positions?.destroy();
    this.normals?.destroy();
    this.positions = null;
    this.normals = null;
    this.vertexCount = 0;
    this.capacity = 0;
    this.uniforms.destroy();
  }
}
