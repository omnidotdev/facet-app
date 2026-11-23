import { meshToStlBinary } from "./stl";
import { partsTo3mf } from "./threeMf";

import type {
  AsyncKernel,
  EvaluateOptions,
  ExportFormat,
  Kernel,
  Mesh,
} from "./kernel";
import type { OpNode } from "./opgraph";
import type { Rgb } from "./parseColor";

export type { Rgb } from "./parseColor";

/**
 * Part colors. `shape.color("red")` tags a subtree with a color; before a
 * model is evaluated it is split into one plain op-graph per color, each
 * evaluated on the active kernel as usual. The parts are drawn in their colors
 * and written to a 3MF as separate parts of one object, which slicers load as
 * a multi-part model whose parts can each take their own filament.
 *
 * Colors follow the usual scripted-CAD rules:
 *
 * - the innermost color wins, so an assembly can be colored as a whole while
 *   a part inside keeps its own
 * - a union keeps differently colored parts as separate bodies (same-colored
 *   ones merge), so they never fuse into one color
 * - a difference or intersection cuts every colored part of its first child
 *   by the rest, whose colors do not matter (a cutter leaves no material)
 * - transforms and edge treatments apply to each part
 * - a hull wraps everything into one body, in the first color it contains
 */

/** One evaluated-to-be piece of a model: a plain graph and its color, if any */
export interface ColoredPart {
  node: OpNode;
  color: Rgb | null;
}

/** A model's evaluated parts, ready to draw or export */
export interface EvaluatedPart {
  mesh: Mesh;
  color: Rgb | null;
}

/** Whether a graph colors anything */
export function hasColor(node: OpNode): boolean {
  if (node.op === "color") return true;
  if ("child" in node) return hasColor(node.child);
  if ("children" in node) return node.children.some(hasColor);
  return false;
}

/** The graph with every color removed, for kernels and cutters */
export function stripColors(node: OpNode): OpNode {
  if (!hasColor(node)) return node;
  if (node.op === "color") return stripColors(node.child);
  if ("child" in node) return { ...node, child: stripColors(node.child) };
  if ("children" in node)
    return { ...node, children: node.children.map(stripColors) };
  return node;
}

/** The first color a graph contains, depth first, or null */
function firstColor(node: OpNode): Rgb | null {
  if (node.op === "color") return firstColor(node.child) ?? [...node.rgb];
  if ("child" in node) return firstColor(node.child);
  if ("children" in node)
    for (const child of node.children) {
      const color = firstColor(child);
      if (color) return color;
    }
  return null;
}

const colorKey = (color: Rgb | null): string =>
  color ? color.map((c) => c.toFixed(4)).join(",") : "none";

/**
 * Split a graph into one plain graph per color (see the module comment for the
 * rules). An uncolored graph comes back whole, as a single uncolored part
 */
export function splitByColor(node: OpNode): ColoredPart[] {
  if (!hasColor(node)) return [{ node, color: null }];
  switch (node.op) {
    case "color":
      // The innermost color wins: only parts still uncolored take this one
      return splitByColor(node.child).map((part) => ({
        node: part.node,
        color: part.color ?? [...node.rgb],
      }));
    case "union": {
      // Same-colored parts merge; differently colored ones stay separate
      const groups = new Map<string, ColoredPart[]>();
      for (const child of node.children)
        for (const part of splitByColor(child)) {
          const key = colorKey(part.color);
          const group = groups.get(key);
          if (group) group.push(part);
          else groups.set(key, [part]);
        }
      return [...groups.values()].map((group) => ({
        color: group[0].color,
        node:
          group.length === 1
            ? group[0].node
            : { op: "union", children: group.map((part) => part.node) },
      }));
    }
    case "difference":
    case "intersect": {
      // Cut each part of the first child by the rest; a cutter's color is moot
      const [first, ...rest] = node.children;
      if (!first) return [];
      const cutters = rest.map(stripColors);
      return splitByColor(first).map((part) => ({
        color: part.color,
        node: { op: node.op, children: [part.node, ...cutters] },
      }));
    }
    case "hull":
      return [{ node: stripColors(node), color: firstColor(node) }];
    default:
      if ("child" in node)
        return splitByColor(node.child).map((part) => ({
          color: part.color,
          node: { ...node, child: part.node } as OpNode,
        }));
      return [{ node: stripColors(node), color: firstColor(node) }];
  }
}

/**
 * Join evaluated parts into one mesh for the viewport, with a per-vertex color
 * (rgba): colored parts carry their color with alpha 1, uncolored ones alpha 0
 * so the renderer uses its own base color for them
 */
export function combineParts(parts: EvaluatedPart[]): Mesh {
  let triangleCount = 0;
  for (const part of parts) triangleCount += part.mesh.triangleCount;
  const positions = new Float32Array(triangleCount * 9);
  const normals = new Float32Array(triangleCount * 9);
  const colors = new Float32Array(triangleCount * 12);
  let tri = 0;
  for (const { mesh, color } of parts) {
    positions.set(mesh.positions.subarray(0, mesh.triangleCount * 9), tri * 9);
    normals.set(mesh.normals.subarray(0, mesh.triangleCount * 9), tri * 9);
    if (color) {
      const vertices = mesh.triangleCount * 3;
      for (let v = 0; v < vertices; v++) {
        const o = (tri * 3 + v) * 4;
        colors[o] = color[0];
        colors[o + 1] = color[1];
        colors[o + 2] = color[2];
        colors[o + 3] = 1;
      }
    }
    tri += mesh.triangleCount;
  }
  return {
    positions,
    normals,
    colors,
    triangleCount,
    parts: parts.map((part) => part.mesh.triangleCount),
  };
}

/** Evaluate every color part of a graph on the kernel, in order */
async function evaluateParts(
  kernel: Kernel | AsyncKernel,
  node: OpNode,
  options?: EvaluateOptions,
): Promise<EvaluatedPart[]> {
  const parts = splitByColor(node);
  const out: EvaluatedPart[] = [];
  // One at a time: the B-rep kernel's worker evaluates serially anyway, and a
  // failing part should fail the whole model with its own message
  for (const part of parts)
    out.push({
      mesh: await kernel.evaluate(part.node, options),
      color: part.color,
    });
  return out;
}

/**
 * Evaluate a model for display. An uncolored model goes straight to the
 * kernel; a colored one is evaluated part by part and joined with per-vertex
 * colors
 */
export async function evaluateColored(
  kernel: Kernel | AsyncKernel,
  node: OpNode,
  options?: EvaluateOptions,
): Promise<Mesh> {
  if (!hasColor(node)) return kernel.evaluate(node, options);
  return combineParts(await evaluateParts(kernel, node, options));
}

/**
 * Export a model. An uncolored model goes straight to the kernel. A colored
 * one is exported part by part: a 3MF carries each part, in its color, as a
 * part of one object; an STL (which has no color) joins them; a STEP is the
 * exact solid of the uncolored model
 */
export async function exportColored(
  kernel: Kernel | AsyncKernel,
  node: OpNode,
  format: ExportFormat,
): Promise<Uint8Array> {
  if (!hasColor(node)) return kernel.export(node, format);
  if (format === "step") return kernel.export(stripColors(node), format);
  const parts = await evaluateParts(kernel, node);
  if (format === "3mf") return partsTo3mf(parts);
  return meshToStlBinary(combineParts(parts));
}
