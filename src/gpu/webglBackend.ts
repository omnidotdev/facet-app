import {
  GRID_CELL,
  GRID_FADE_END,
  GRID_FADE_START,
  GRID_QUAD,
} from "./gridSpec";

import type { FrameParams, RenderBackend } from "./backend";

/**
 * WebGL 2 compatibility renderer, used when WebGPU is unavailable or fails
 * (most notably Chromium-based browsers on Linux, where WebGPU is still off by
 * default or sits behind an unsafe flag). It draws the same scene as the
 * WebGPU pipelines, with GLSL ports of their shaders.
 *
 * Deprecation: WebGPU is the long-term path and this backend is a bridge.
 * Remove it (and the renderer setting) once WebGPU ships on by default in
 * every major desktop browser on every desktop OS, Linux included. Until then,
 * new rendering features land in WebGPU first and are ported here only when
 * the preview would otherwise be wrong without them
 */

// The camera builds a WebGPU-style projection (clip depth 0..1); WebGL clips
// depth to -1..1, so remap z after the multiply
const DEPTH_REMAP = "gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;";

const MESH_VERTEX = `#version 300 es
uniform mat4 uViewProj;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
out vec3 vNormal;
void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  ${DEPTH_REMAP}
  vNormal = aNormal;
}`;

// Mirrors the WebGPU mesh fragment shader (key light plus Z-up hemisphere fill)
const MESH_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 uLightDir;
uniform vec4 uBaseColor;
in vec3 vNormal;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 l = normalize(uLightDir);
  float key = max(dot(n, l), 0.0) * 1.1;
  float hemiFactor = n.z * 0.5 + 0.5;
  vec3 hemi = mix(vec3(0.38, 0.38, 0.36), vec3(1.0), hemiFactor);
  vec3 lighting = hemi * 0.85 + vec3(key);
  outColor = vec4(uBaseColor.rgb * lighting, 1.0);
}`;

const GRID_VERTEX = `#version 300 es
uniform mat4 uViewProj;
layout(location = 0) in vec3 aPosition;
out vec2 vWorld;
void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  ${DEPTH_REMAP}
  vWorld = aPosition.xy;
}`;

const glslFloat = (n: number): string =>
  Number.isInteger(n) ? `${n}.0` : String(n);

// Mirrors the WebGPU grid fragment shader (antialiased lines, radial fade)
const GRID_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 uColor;
in vec2 vWorld;
out vec4 outColor;
void main() {
  vec2 cells = vWorld / ${glslFloat(GRID_CELL)};
  vec2 f = fract(cells);
  vec2 toLine = min(f, vec2(1.0) - f);
  vec2 px = toLine / fwidth(cells);
  float line = 1.0 - min(min(px.x, px.y), 1.0);
  float fade = 1.0 - smoothstep(${glslFloat(GRID_FADE_START)}, ${glslFloat(GRID_FADE_END)}, length(vWorld));
  outColor = vec4(uColor.rgb, line * uColor.a * fade);
}`;

const compile = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("could not create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
};

const link = (
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram => {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  return program;
};

const uniform = (
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation | null => gl.getUniformLocation(program, name);

/** Flip bottom-up `readPixels` rows into the top-down order captures use */
export const flipRows = (
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> => {
  const rowBytes = width * 4;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const src = (height - 1 - y) * rowBytes;
    out.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
  }
  return out;
};

class WebGlBackend implements RenderBackend {
  readonly kind = "webgl" as const;

  private readonly meshProgram: WebGLProgram;
  private readonly gridProgram: WebGLProgram;
  private readonly meshVao: WebGLVertexArrayObject;
  private readonly gridVao: WebGLVertexArrayObject;
  private readonly positionBuffer: WebGLBuffer;
  private readonly normalBuffer: WebGLBuffer;
  private readonly gridBuffer: WebGLBuffer;
  private readonly loc: {
    meshViewProj: WebGLUniformLocation | null;
    lightDir: WebGLUniformLocation | null;
    baseColor: WebGLUniformLocation | null;
    gridViewProj: WebGLUniformLocation | null;
    gridColor: WebGLUniformLocation | null;
  };
  private vertexCount = 0;
  private width = 1;
  private height = 1;
  private lost = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
  ) {
    this.meshProgram = link(gl, MESH_VERTEX, MESH_FRAGMENT);
    this.gridProgram = link(gl, GRID_VERTEX, GRID_FRAGMENT);
    this.loc = {
      meshViewProj: uniform(gl, this.meshProgram, "uViewProj"),
      lightDir: uniform(gl, this.meshProgram, "uLightDir"),
      baseColor: uniform(gl, this.meshProgram, "uBaseColor"),
      gridViewProj: uniform(gl, this.gridProgram, "uViewProj"),
      gridColor: uniform(gl, this.gridProgram, "uColor"),
    };

    this.positionBuffer = gl.createBuffer();
    this.normalBuffer = gl.createBuffer();
    this.meshVao = gl.createVertexArray();
    gl.bindVertexArray(this.meshVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    this.gridBuffer = gl.createBuffer();
    this.gridVao = gl.createVertexArray();
    gl.bindVertexArray(this.gridVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, GRID_QUAD, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // A lost context draws nothing until the viewport is rebuilt (switching
    // renderer or reloading); preventDefault keeps the browser willing to restore
    canvas.addEventListener("webglcontextlost", this.onContextLost);

    this.resize(canvas.width, canvas.height);
  }

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
  };

  resize(width: number, height: number): void {
    this.width = Math.max(width, 1);
    this.height = Math.max(height, 1);
  }

  setMesh(
    positions: Float32Array,
    normals: Float32Array,
    triangleCount: number,
  ): void {
    if (this.lost) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.DYNAMIC_DRAW);
    this.vertexCount = triangleCount * 3;
  }

  draw(frame: FrameParams): void {
    if (this.lost) return;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.drawScene(this.width, this.height, frame);
  }

  async capture(
    width: number,
    height: number,
    frame: FrameParams,
  ): Promise<Uint8ClampedArray<ArrayBuffer> | null> {
    if (this.lost) return null;
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    const color = gl.createRenderbuffer();
    const depth = gl.createRenderbuffer();
    try {
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(
        gl.RENDERBUFFER,
        gl.DEPTH_COMPONENT24,
        width,
        height,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.RENDERBUFFER,
        color,
      );
      gl.framebufferRenderbuffer(
        gl.FRAMEBUFFER,
        gl.DEPTH_ATTACHMENT,
        gl.RENDERBUFFER,
        depth,
      );
      if (
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
      ) {
        return null;
      }
      this.drawScene(width, height, frame);
      const raw = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      return flipRows(raw, width, height);
    } catch {
      return null;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteRenderbuffer(color);
      gl.deleteRenderbuffer(depth);
    }
  }

  /** Draw grid then solid into the bound framebuffer, matching the WebGPU pass */
  private drawScene(width: number, height: number, frame: FrameParams): void {
    const gl = this.gl;
    const bg = frame.background;
    gl.viewport(0, 0, width, height);
    gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);

    // Grid: depth-tested but never written, alpha blended under the solid
    gl.useProgram(this.gridProgram);
    gl.uniformMatrix4fv(this.loc.gridViewProj, false, frame.viewProj);
    gl.uniform4fv(this.loc.gridColor, frame.grid);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );
    gl.bindVertexArray(this.gridVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Solid
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    if (this.vertexCount > 0) this.drawMesh(frame);
    gl.bindVertexArray(null);
  }

  private drawMesh(frame: FrameParams): void {
    const gl = this.gl;
    gl.useProgram(this.meshProgram);
    gl.uniformMatrix4fv(this.loc.meshViewProj, false, frame.viewProj);
    gl.uniform3fv(this.loc.lightDir, frame.lightDir);
    gl.uniform4fv(this.loc.baseColor, frame.baseColor);
    gl.bindVertexArray(this.meshVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
  }

  dispose(): void {
    const gl = this.gl;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.normalBuffer);
    gl.deleteBuffer(this.gridBuffer);
    gl.deleteVertexArray(this.meshVao);
    gl.deleteVertexArray(this.gridVao);
    gl.deleteProgram(this.meshProgram);
    gl.deleteProgram(this.gridProgram);
  }
}

/** Set up WebGL 2 on the canvas, or null when the browser has none */
export const createWebGlBackend = (
  canvas: HTMLCanvasElement,
): RenderBackend | null => {
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    alpha: false,
    depth: true,
  });
  if (!gl) return null;
  try {
    return new WebGlBackend(canvas, gl);
  } catch (err) {
    console.warn("WebGL renderer setup failed:", err);
    return null;
  }
};
