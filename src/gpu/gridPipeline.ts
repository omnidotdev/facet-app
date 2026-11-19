import tgpu from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";

import {
  GRID_CELL as CELL,
  GRID_FADE_END as FADE_END,
  GRID_FADE_START as FADE_START,
  GRID_QUAD as QUAD,
} from "./gridSpec";
import { sceneLayout } from "./meshPipeline";

import type {
  TgpuBuffer,
  TgpuRenderPass,
  TgpuRenderPipeline,
  TgpuRoot,
  UniformFlag,
  VertexFlag,
} from "typegpu";
import type { SceneBindGroup } from "./meshPipeline";

const quadLayout = tgpu.vertexLayout((n: number) =>
  d.disarrayOf(d.float32x3, n),
);

// The grid color (rgb) plus its theme opacity (a) is the grid's own uniform;
// the shared scene uniform carries only the camera and the solid's material
const colorSchema = d.vec4f;
const colorLayout = tgpu.bindGroupLayout({ color: { uniform: colorSchema } });

const vertexMain = tgpu.vertexFn({
  in: { position: d.vec3f },
  out: { pos: d.builtin.position, world: d.vec2f },
})((input) => {
  "use gpu";
  return {
    pos: std.mul(sceneLayout.$.scene.viewProj, d.vec4f(input.position, 1)),
    world: input.position.xy,
  };
});

const fragmentMain = tgpu.fragmentFn({
  in: { world: d.vec2f },
  out: d.vec4f,
})((input) => {
  "use gpu";
  const color = colorLayout.$.color;
  const cells = std.mul(input.world, 1 / CELL);
  const frac = std.fract(cells);
  // Distance to the nearest integer line on each axis, antialiased by the
  // screen-space derivative so lines stay a consistent thickness at any zoom
  const toLine = std.min(frac, std.sub(d.vec2f(1, 1), frac));
  const px = std.div(toLine, std.fwidth(cells));
  const line = 1 - std.min(std.min(px.x, px.y), 1);
  const fade =
    1 - std.smoothstep(FADE_START, FADE_END, std.length(input.world));
  return d.vec4f(color.xyz, line * color.w * fade);
});

type QuadBuffer = ReturnType<typeof quadLayout.schemaForCount>;
type ColorBuffer = TgpuBuffer<typeof colorSchema> & UniformFlag;

/** Draws the blueprint ground grid on the XY plane, blended under the solid. */
export class GridPipeline {
  private readonly pipeline: TgpuRenderPipeline;
  private readonly quad: TgpuBuffer<QuadBuffer> & VertexFlag;
  private readonly color: ColorBuffer;
  private readonly colorGroup: SceneBindGroup;

  constructor(
    root: TgpuRoot,
    format: GPUTextureFormat,
    depthFormat: GPUTextureFormat,
  ) {
    this.quad = root
      .createBuffer(quadLayout.schemaForCount(6))
      .$usage("vertex");
    root.device.queue.writeBuffer(this.quad.buffer, 0, QUAD);

    this.color = root.createBuffer(colorSchema).$usage("uniform");
    this.colorGroup = root.createBindGroup(colorLayout, { color: this.color });

    this.pipeline = root.createRenderPipeline({
      vertex: vertexMain,
      fragment: fragmentMain,
      attribs: { position: quadLayout.attrib },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: {
        format: depthFormat,
        // The grid never occludes the solid: it tests depth but does not write it
        depthWriteEnabled: false,
        depthCompare: "less",
      },
      targets: {
        format,
        blend: {
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
        },
      },
    });
  }

  /** Recolor the grid for the active theme (rgb plus opacity in the fourth channel). */
  setColor(color: readonly [number, number, number, number]): void {
    this.color.write(color);
  }

  /** Record the grid draw into an already-open pass, reusing the shared scene uniform. */
  render(pass: TgpuRenderPass, scene: SceneBindGroup): void {
    this.pipeline
      .with(quadLayout, this.quad)
      .with(scene)
      .with(this.colorGroup)
      .with(pass)
      .draw(6);
  }

  dispose(): void {
    this.quad.destroy();
    this.color.destroy();
  }
}
