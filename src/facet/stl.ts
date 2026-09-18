import type { Mesh } from "./kernel";

/**
 * Binary STL export. One facet record per triangle: a face normal, three
 * vertices, and a 2-byte attribute count. The 80-byte header is left blank.
 */
export function meshToStlBinary(mesh: Mesh): Uint8Array {
  const tris = mesh.triangleCount;
  const buffer = new ArrayBuffer(84 + tris * 50);
  const view = new DataView(buffer);
  view.setUint32(80, tris, true);

  const p = mesh.positions;
  const n = mesh.normals;
  let off = 84;
  for (let t = 0; t < tris; t++) {
    const b = t * 9;
    // Flat normal: every vertex of the triangle carries the same face normal.
    view.setFloat32(off, n[b], true);
    view.setFloat32(off + 4, n[b + 1], true);
    view.setFloat32(off + 8, n[b + 2], true);
    off += 12;
    for (let k = 0; k < 3; k++) {
      view.setFloat32(off, p[b + k * 3], true);
      view.setFloat32(off + 4, p[b + k * 3 + 1], true);
      view.setFloat32(off + 8, p[b + k * 3 + 2], true);
      off += 12;
    }
    view.setUint16(off, 0, true);
    off += 2;
  }
  return new Uint8Array(buffer);
}
