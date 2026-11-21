import { repairForExport } from "./meshRepair";

import type { Mesh } from "./kernel";

/**
 * Binary STL export. One facet record per triangle: a face normal, three
 * vertices, and a 2-byte attribute count. The 80-byte header is left blank.
 * The mesh is welded and closed first (see meshRepair.ts) so slicers see a
 * watertight part, and each normal is taken from the triangle's winding so the
 * two always agree.
 */
export function meshToStlBinary(mesh: Mesh): Uint8Array {
  const { vertices: v, triangles } = repairForExport(mesh);
  const tris = triangles.length / 3;
  const buffer = new ArrayBuffer(84 + tris * 50);
  const view = new DataView(buffer);
  view.setUint32(80, tris, true);

  let off = 84;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3;
    const b = triangles[t + 1] * 3;
    const c = triangles[t + 2] * 3;
    const ux = v[b] - v[a];
    const uy = v[b + 1] - v[a + 1];
    const uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a];
    const wy = v[c + 1] - v[a + 1];
    const wz = v[c + 2] - v[a + 2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    view.setFloat32(off, nx / len, true);
    view.setFloat32(off + 4, ny / len, true);
    view.setFloat32(off + 8, nz / len, true);
    off += 12;
    for (const i of [a, b, c]) {
      view.setFloat32(off, v[i], true);
      view.setFloat32(off + 4, v[i + 1], true);
      view.setFloat32(off + 8, v[i + 2], true);
      off += 12;
    }
    view.setUint16(off, 0, true);
    off += 2;
  }
  return new Uint8Array(buffer);
}
