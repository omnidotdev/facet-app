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

  test("welds shared vertices into a closed indexed mesh", () => {
    const mesh = meshKernel.evaluate(cube(10).node);
    const text = new TextDecoder().decode(meshTo3mf(mesh));
    const triangles = [
      ...text.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g),
    ].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    const vertCount = (text.match(/<vertex /g) ?? []).length;
    expect(triangles).toHaveLength(mesh.triangleCount); // 12 for a cube
    // A cube has 8 corners; unwelded it would be 36 loose vertices
    expect(vertCount).toBe(8);
    // Watertight: every edge is shared by exactly two triangles
    const edges = new Map<string, number>();
    for (const tri of triangles) {
      for (let k = 0; k < 3; k++) {
        const a = tri[k];
        const b = tri[(k + 1) % 3];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const count of edges.values()) expect(count).toBe(2);
  });

  test("drops triangles that collapse under coordinate rounding", () => {
    const mesh = {
      positions: new Float32Array([0, 0, 0, 0.00001, 0, 0, 1, 1, 0]),
      normals: new Float32Array(9),
      triangleCount: 1,
    };
    const text = new TextDecoder().decode(meshTo3mf(mesh));
    expect(text).not.toContain("<triangle ");
  });
});
