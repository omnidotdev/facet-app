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
  style: readonly [number, number, number, number];
  edgeColor: readonly [number, number, number, number];
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
// Three edge flags per vertex, the same for each vertex of a triangle
const edgeLayout = tgpu.vertexLayout((n: number) =>
  d.disarrayOf(d.float32x3, n),
);
// A part color per vertex (rgba; alpha 0 keeps the base color)
const colorLayout = tgpu.vertexLayout((n: number) =>
  d.disarrayOf(d.float32x4, n),
);

type MeshVertexSchema = ReturnType<typeof positionLayout.schemaForCount>;
type MeshVertexBuffer = TgpuBuffer<MeshVertexSchema> & VertexFlag;
type ColorVertexBuffer = TgpuBuffer<
  ReturnType<typeof colorLayout.schemaForCount>
> &
  VertexFlag;

const vertexMain = tgpu.vertexFn({
  in: {
    position: d.vec3f,
    normal: d.vec3f,
    edges: d.vec3f,
    color: d.vec4f,
    index: d.builtin.vertexIndex,
  },
  out: {
    pos: d.builtin.position,
    worldNormal: d.vec3f,
    bary: d.vec3f,
    edges: d.vec3f,
    color: d.vec4f,
  },
})((input) => {
  "use gpu";
  // Meshes are non-indexed, three vertices per triangle, so a vertex's place
  // in its triangle gives the barycentric corner it stands for; interpolated,
  // that is each fragment's distance to the three edges
  const corner = d.f32(input.index % 3);
  const first = 1 - std.step(0.5, corner);
  const last = std.step(1.5, corner);
  return {
    pos: std.mul(sceneLayout.$.scene.viewProj, d.vec4f(input.position, 1)),
    // Flat normals are baked per face by the kernel, so pass them straight through
    worldNormal: input.normal,
    bary: d.vec3f(first, 1 - first - last, last),
    edges: input.edges,
    color: input.color,
  };
});

const fragmentMain = tgpu.fragmentFn({
  in: {
    worldNormal: d.vec3f,
    bary: d.vec3f,
    edges: d.vec3f,
    color: d.vec4f,
  },
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
  // A part color where the model sets one, else the theme's base color. The
  // lighting peaks near 1.7x on a top face, tuned for the default color; a
  // chosen part color is exposed down so its lit top shows the color as picked
  const base = std.mix(scene.baseColor.xyz, input.color.xyz, input.color.w);
  const exposure = std.mix(1, 0.6, input.color.w);
  const shaded = std.mul(base, std.mul(lighting, exposure));
  // The render mode's lines (style: fill opacity, edge strength, line
  // half-width in device pixels): distance to each flagged edge in pixels,
  // unflagged edges pushed far away
  const px = std.div(
    input.bary,
    std.max(std.fwidth(input.bary), d.vec3f(1e-6, 1e-6, 1e-6)),
  );
  // A drawn edge stores 1000 plus where the opposite corner projects along
  // it, which gives each pixel's place along the edge, so the line stops at
  // the edge's ends instead of running on through a sliver triangle
  const drawn = std.step(d.vec3f(500, 500, 500), input.edges);
  const along = std.add(
    input.bary.zxy,
    std.mul(input.bary, std.sub(input.edges, d.vec3f(1000, 1000, 1000))),
  );
  const within = std.mul(
    std.step(d.vec3f(-0.001, -0.001, -0.001), along),
    std.step(along, d.vec3f(1.001, 1.001, 1.001)),
  );
  const dist = std.mix(d.vec3f(1e6, 1e6, 1e6), px, std.mul(drawn, within));
  const nearest = std.min(std.min(dist.x, dist.y), dist.z);
  const width = scene.style.z;
  const line =
    (1 - std.smoothstep(width - 0.5, width + 0.5, nearest)) * scene.style.y;
  const alpha = std.max(scene.style.x, line);
  if (alpha < 0.004) {
    std.discard();
  }
  // The mode's line color is tuned for the default color; on a dark part
  // color (navy, black) it would vanish, so a solid colored part with a dark
  // color gets a light line instead
  const dark = std.step(std.dot(base, d.vec3f(0.2126, 0.7152, 0.0722)), 0.3);
  const light = std.mix(base, d.vec3f(1, 1, 1), 0.8);
  const edgeColor = std.mix(
    scene.edgeColor.xyz,
    light,
    dark * input.color.w * std.step(0.99, scene.style.x),
  );
  return d.vec4f(std.mix(shaded, edgeColor, line), alpha);
});

/** Blending for the see-through modes; harmless for opaque ones (alpha 1) */
const BLEND: GPUBlendState = {
  color: {
    srcFactor: "src-alpha",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
  alpha: {
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
};

/** Owns the render pipeline, scene uniform, and vertex buffers for the Facet solid. */
export class MeshPipeline {
  /** Opaque modes write depth; see-through modes blend every layer without it */
  private readonly pipeline: TgpuRenderPipeline;
  private readonly seeThroughPipeline: TgpuRenderPipeline;
  private readonly uniforms: TgpuBuffer<typeof SceneUniforms> & UniformFlag;
  /** Shared so the grid pipeline can bind the same scene uniform. */
  readonly bindGroup: SceneBindGroup;

  private positions: MeshVertexBuffer | null = null;
  private normals: MeshVertexBuffer | null = null;
  private edges: MeshVertexBuffer | null = null;
  private colors: ColorVertexBuffer | null = null;
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
    const pipelineFor = (depthWriteEnabled: boolean) =>
      root.createRenderPipeline({
        vertex: vertexMain,
        fragment: fragmentMain,
        attribs: {
          position: positionLayout.attrib,
          normal: normalLayout.attrib,
          edges: edgeLayout.attrib,
          color: colorLayout.attrib,
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
          format: depthFormat,
          depthWriteEnabled,
          depthCompare: "less",
        },
        targets: { format, blend: BLEND },
      });
    this.pipeline = pipelineFor(true);
    this.seeThroughPipeline = pipelineFor(false);
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
    edges: Float32Array,
    colors: Float32Array,
    triangleCount: number,
  ): void {
    const vertexCount = triangleCount * 3;
    if (
      !this.positions ||
      !this.normals ||
      !this.edges ||
      !this.colors ||
      vertexCount > this.capacity
    ) {
      this.positions?.destroy();
      this.normals?.destroy();
      this.edges?.destroy();
      this.colors?.destroy();
      this.positions = this.root
        .createBuffer(positionLayout.schemaForCount(vertexCount))
        .$usage("vertex");
      this.normals = this.root
        .createBuffer(normalLayout.schemaForCount(vertexCount))
        .$usage("vertex");
      this.edges = this.root
        .createBuffer(edgeLayout.schemaForCount(vertexCount))
        .$usage("vertex");
      this.colors = this.root
        .createBuffer(colorLayout.schemaForCount(vertexCount))
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
    queue.writeBuffer(this.edges.buffer, 0, edges as Float32Array<ArrayBuffer>);
    queue.writeBuffer(
      this.colors.buffer,
      0,
      colors as Float32Array<ArrayBuffer>,
    );
    this.vertexCount = vertexCount;
  }

  /** Rewrite the edge flags of the current solid */
  setEdges(edges: Float32Array): void {
    if (!this.edges || edges.length !== this.vertexCount * 3) return;
    this.root.device.queue.writeBuffer(
      this.edges.buffer,
      0,
      edges as Float32Array<ArrayBuffer>,
    );
  }

  /** Serialize the current frame's scene uniform. */
  writeUniforms(values: SceneUniformValues): void {
    this.uniforms.write({
      viewProj: values.viewProj,
      lightDir: values.lightDir,
      baseColor: values.baseColor,
      style: values.style,
      edgeColor: values.edgeColor,
    });
  }

  /** Record the mesh draw into an already-open render pass. */
  render(pass: TgpuRenderPass, seeThrough = false): void {
    if (!this.positions || !this.normals || !this.edges || !this.colors) return;
    if (this.vertexCount === 0) return;
    (seeThrough ? this.seeThroughPipeline : this.pipeline)
      .with(positionLayout, this.positions)
      .with(normalLayout, this.normals)
      .with(edgeLayout, this.edges)
      .with(colorLayout, this.colors)
      .with(this.bindGroup)
      .with(pass)
      .draw(this.vertexCount);
  }

  dispose(): void {
    this.positions?.destroy();
    this.normals?.destroy();
    this.edges?.destroy();
    this.colors?.destroy();
    this.positions = null;
    this.normals = null;
    this.edges = null;
    this.colors = null;
    this.vertexCount = 0;
    this.capacity = 0;
    this.uniforms.destroy();
  }
}
