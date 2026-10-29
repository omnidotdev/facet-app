import * as d from "typegpu/data";

/** Per-frame scene uniforms shared by the CPU writer and the TGSL shaders. */
export const SceneUniforms = d.struct({
  viewProj: d.mat4x4f,
  lightDir: d.vec3f,
  baseColor: d.vec4f,
  background: d.vec4f,
});
