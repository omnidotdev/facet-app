/**
 * Evaluate a user/AI model into an op-graph, in isolation from the page.
 *
 * This is the one place that runs model code with `new Function`. It is loaded
 * by the Web Worker (modelWorker.ts), whose global scope has no `window`,
 * `document`, or `localStorage`, so model code cannot read the session token or
 * touch the DOM. The op-graph (`OpNode`) and param declarations it returns are
 * plain serializable data posted back to the main thread, which owns the kernel,
 * the viewport, and the parameter UI. Pure and synchronous, so it is unit-tested
 * directly without a worker.
 */

import {
  Shape,
  box,
  circle,
  cube,
  cylinder,
  difference,
  extrude,
  grid,
  importSvg,
  intersection,
  polygon,
  rect,
  rectTube,
  revolve,
  sphere,
  square,
  text,
  union,
} from "@/facet/api";
import { ParamStore } from "@/params";

import type { OpNode } from "@/facet/opgraph";
import type { ParamDecl, ParamValue } from "@/params";

/** The API surface injected into model code (identical to the old inline one). */
const modelApi = {
  cube,
  box,
  sphere,
  cylinder,
  union,
  difference,
  intersection,
  grid,
  rectTube,
  circle,
  square,
  rect,
  polygon,
  importSvg,
  text,
  extrude,
  revolve,
} as const;

export type BuildResult =
  | { ok: true; node: OpNode; decls: ParamDecl[] }
  | { ok: false; error: string };

/**
 * Run model `code` with the Facet API and a param store seeded from `values`,
 * returning the op-graph plus the parameters it declared, or a user-facing
 * error. Never throws.
 */
export function buildModel(
  code: string,
  values: Record<string, ParamValue>,
): BuildResult {
  const store = new ParamStore();
  store.seed(values);
  const names = [...Object.keys(modelApi), "param"];
  try {
    // Runs only inside the sandboxed Web Worker (no DOM/token access); see
    // plans/facet-security-hardening.md
    const fn = new Function(...names, `"use strict";\n${code}`);
    const result = fn(...Object.values(modelApi), store.api());
    if (!(result instanceof Shape)) {
      return {
        ok: false,
        error: "Your model must `return` a shape (e.g. `return cube(10);`).",
      };
    }
    return { ok: true, node: result.node, decls: store.list() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
