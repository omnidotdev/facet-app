import * as d from "typegpu/data";

/** Per-frame scene uniforms shared by the CPU writer and the TGSL shaders. */
export const SceneUniforms = d.struct({
  viewProj: d.mat4x4f,
  lightDir: d.vec3f,
  baseColor: d.vec4f,
  /** Fill opacity, edge strength, line half-width (device px), spare */
  style: d.vec4f,
  edgeColor: d.vec4f,
});
