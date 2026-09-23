import { describe, expect, test } from "bun:test";

import { cube } from "./api";
import { meshKernel } from "./meshKernel";
import { meshTo3mf } from "./threeMf";

describe("3mf export", () => {
  test("produces a valid zip container with the required 3mf parts", () => {
    const mesh = meshKernel.evaluate(cube(10).node);
    const buf = meshTo3mf(mesh);
    // ZIP local-file-header signature "PK\x03\x04"
    expect([buf[0], buf[1], buf[2], buf[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(buf);
    expect(text).toContain("[Content_Types].xml");
    expect(text).toContain("_rels/.rels");
    expect(text).toContain("3D/3dmodel.model");
    // end-of-central-directory signature "PK\x05\x06"
    expect(text).toContain("PK\x05\x06");
  });

  test("emits one triangle element per mesh triangle (non-indexed vertices)", () => {
    const mesh = meshKernel.evaluate(cube(10).node);
    const text = new TextDecoder().decode(meshTo3mf(mesh));
    const triCount = (text.match(/<triangle /g) ?? []).length;
    const vertCount = (text.match(/<vertex /g) ?? []).length;
    expect(triCount).toBe(mesh.triangleCount); // 12 for a cube
    expect(vertCount).toBe(mesh.triangleCount * 3);
  });
});
