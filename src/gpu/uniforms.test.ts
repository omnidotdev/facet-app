import { describe, expect, it } from "bun:test";

import * as d from "typegpu/data";

import { SceneUniforms } from "./uniforms";

describe("SceneUniforms", () => {
  it("has a stable, std140-compatible byte size", () => {
    expect(d.sizeOf(SceneUniforms)).toBe(96);
  });

  it("orders fields viewProj, lightDir, baseColor", () => {
    expect(Object.keys(SceneUniforms.propTypes)).toEqual([
      "viewProj",
      "lightDir",
      "baseColor",
    ]);
  });
});
