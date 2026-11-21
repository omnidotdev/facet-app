import { describe, expect, test } from "bun:test";

import {
  cube,
  cylinder,
  extrude,
  polygon,
  revolve,
  sphere,
  square,
} from "./api";
import { meshKernel } from "./meshKernel";
import { repairForExport } from "./meshRepair";
import { loadWasmKernel } from "./wasmKernel";

import type { Kernel, Mesh } from "./kernel";
import type { OpNode } from "./opgraph";

/**
 * Exports must reach a slicer as one closed, outward-facing solid. An open edge
 * invites slicer mesh repair, which can fill real holes (a key-ring hole came
 * out solid from a 3MF), and an inside-out part slices as empty or inverted.
 * These read each exported file back and check its topology the way a slicer
 * does.
 */

type Tri = [number, number, number];

interface Solid {
  vertices: number[][];
  triangles: Tri[];
}

/** Edges used other than exactly once each way, and the signed volume */
function solidStats({ vertices, triangles }: Solid) {
  const directed = new Map<string, number>();
  for (const [a, b, c] of triangles) {
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = `${u}>${v}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  let badEdges = 0;
  for (const [key, count] of directed) {
    const [u, v] = key.split(">");
    if (count !== 1 || directed.get(`${v}>${u}`) !== 1) badEdges++;
  }
  let volume = 0;
  for (const [a, b, c] of triangles) {
    const [ax, ay, az] = vertices[a];
    const [bx, by, bz] = vertices[b];
    const [cx, cy, cz] = vertices[c];
    volume +=
      (ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx)) /
      6;
  }
  return { badEdges, volume };
}

/** Read a binary STL back, welding vertices by exact position as slicers do */
function readStl(bytes: Uint8Array): Solid {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  expect(bytes.byteLength).toBe(84 + count * 50);
  const index = new Map<string, number>();
  const vertices: number[][] = [];
  const triangles: Tri[] = [];
  for (let t = 0; t < count; t++) {
    const base = 84 + t * 50 + 12;
    const ids = [0, 1, 2].map((k) => {
      const p = [0, 1, 2].map((d) =>
        view.getFloat32(base + k * 12 + d * 4, true),
      );
      const key = p.join(",");
      let id = index.get(key);
      if (id === undefined) {
        id = vertices.length;
        index.set(key, id);
        vertices.push(p);
      }
      return id;
    });
    triangles.push(ids as Tri);
  }
  return { vertices, triangles };
}

/** Read the model part of a stored (uncompressed) 3MF package back */
function read3mf(bytes: Uint8Array): Solid {
  const xml = new TextDecoder().decode(bytes);
  const vertices = [
    ...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g),
  ].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  const triangles = [
    ...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g),
  ].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as Tri);
  return { vertices, triangles };
}

const MODELS: [string, () => OpNode, number][] = [
  // A boolean leaves T-junctions where the BSP split one face but not its
  // neighbour
  [
    "a plate with a through hole",
    () =>
      cube([30, 20, 5], { center: true }).subtract(
        cylinder(4, 20, { segments: 48 }),
      ).node,
    3000 - Math.PI * 16 * 5,
  ],
  [
    "a sphere unioned with a cube",
    () => sphere(10, { segments: 24 }).union(cube(12).translate(4, 4, 4)).node,
    4700,
  ],
  [
    "a clockwise profile extruded and drilled",
    () =>
      extrude(
        polygon([
          [0, 0],
          [0, 10],
          [10, 0],
        ]),
        5,
      ).subtract(cylinder(1.5, 20, { segments: 16 }).translate(3, 3, 0)).node,
    250 - Math.PI * 2.25 * 5,
  ],
  [
    "a twisted extrude unioned with a post",
    () =>
      extrude(square([10, 6], { center: true }), 12, { twist: 60 }).union(
        cube([2, 2, 20], { center: true }),
      ).node,
    752,
  ],
  [
    "a partial revolve cut by a slab",
    () =>
      revolve(square([2, 4]).translate(10, 0), {
        angle: 270,
        segments: 36,
      }).subtract(cube([30, 30, 1], { center: true })).node,
    // A 2x3 section (the slab removes 1 of the 4 mm height) swept 3/4 turn at r=10
    6 * 10 * Math.PI * 1.5,
  ],
];

const wasm = await loadWasmKernel();

const KERNELS: [string, Kernel | null][] = [
  ["TS mesh", meshKernel],
  ["Rust/WASM", wasm],
];

describe("exports are closed, outward-facing solids", () => {
  for (const [kernelName, kernel] of KERNELS) {
    for (const [modelName, build, expected] of MODELS) {
      test.skipIf(!kernel)(`${kernelName}: ${modelName}`, () => {
        const node = build();
        for (const solid of [
          readStl(kernel?.export(node, "stl") ?? new Uint8Array()),
          read3mf(kernel?.export(node, "3mf") ?? new Uint8Array()),
        ]) {
          expect(solid.triangles.length).toBeGreaterThan(0);
          const { badEdges, volume } = solidStats(solid);
          expect(badEdges).toBe(0);
          // Positive means outward-facing; the tolerance covers tessellation
          expect(volume).toBeGreaterThan(expected * 0.97);
          expect(volume).toBeLessThan(expected * 1.03);
        }
      });
    }
  }
});

describe("repairForExport", () => {
  const meshOf = (tris: number[][][]): Mesh => ({
    positions: new Float32Array(tris.flat(2)),
    normals: new Float32Array(tris.length * 9),
    triangleCount: tris.length,
  });

  test("splits a T-junction so both sides share the edge", () => {
    // A unit square face split into two triangles on one side of the x=1 edge
    // and a single triangle on the other: the vertex at (1, 0.5) sits on the
    // middle of the single triangle's edge
    const mesh = meshOf([
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0.5, 0],
      ],
      [
        [0, 0, 0],
        [1, 0.5, 0],
        [1, 1, 0],
      ],
      [
        [1, 0, 0],
        [2, 0.5, 0],
        [1, 1, 0],
      ],
    ]);
    const { triangles } = repairForExport(mesh);
    // The right triangle becomes a fan of two around the inserted vertex
    expect(triangles.length / 3).toBe(4);
    const edges = new Set<string>();
    for (let t = 0; t < triangles.length; t += 3)
      for (let k = 0; k < 3; k++)
        edges.add(`${triangles[t + k]}>${triangles[t + ((k + 1) % 3)]}`);
    // Both halves of the old long edge are now walked both ways
    expect(edges.has("1>2") && edges.has("2>1")).toBe(true);
    expect(edges.has("2>3") && edges.has("3>2")).toBe(true);
  });

  test("welds vertices and leaves an already closed mesh untouched", () => {
    const mesh = meshKernel.evaluate(cube(10).node);
    const { vertices, triangles } = repairForExport(mesh);
    expect(vertices.length / 3).toBe(8);
    expect(triangles.length / 3).toBe(mesh.triangleCount);
  });
});
