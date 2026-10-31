import { describe, expect, test } from "bun:test";

import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";

import { facetApiCompletions } from "./editorCompletions";

import type { CompletionResult } from "@codemirror/autocomplete";

/** Invoke the (synchronous) source with the cursor at the end of `doc`. */
function complete(doc: string, explicit = true): CompletionResult | null {
  const state = EditorState.create({ doc });
  const context = new CompletionContext(state, doc.length, explicit);
  return facetApiCompletions(context) as CompletionResult | null;
}

/** Labels offered with the cursor at the end of `doc`. */
function completeAt(doc: string, explicit = true) {
  return complete(doc, explicit)?.options.map((o) => o.label) ?? null;
}

describe("facet API completions", () => {
  test("top level offers the free functions and the param builder", () => {
    const labels = completeAt("cub");
    expect(labels).not.toBeNull();
    expect(labels).toEqual(
      expect.arrayContaining([
        "cube",
        "box",
        "sphere",
        "cylinder",
        "union",
        "difference",
        "intersection",
        "param",
      ]),
    );
    // Shape methods must not leak into the top-level surface
    expect(labels).not.toContain("fillet");
    expect(labels).not.toContain("subtract");
  });

  test("member access after a shape offers the Shape methods", () => {
    const labels = completeAt("base.");
    expect(labels).not.toBeNull();
    expect(labels).toEqual(
      expect.arrayContaining([
        "union",
        "add",
        "subtract",
        "sub",
        "intersect",
        "translate",
        "move",
        "rotate",
        "scale",
        "fillet",
        "chamfer",
        "shell",
      ]),
    );
    // Top-level primitives must not appear on a member access
    expect(labels).not.toContain("cube");
    expect(labels).not.toContain("param");
  });

  test("member access while typing a method name still offers Shape methods", () => {
    const labels = completeAt("part.fil");
    expect(labels).toEqual(expect.arrayContaining(["fillet", "chamfer"]));
  });

  test("param member access offers only the param builder members", () => {
    const labels = completeAt("param.");
    expect(labels).toEqual(["number"]);
  });

  test("the completion start is placed after the dot for a member access", () => {
    const result = complete("base.un");
    // "base." is 5 chars, so completions replace from index 5 (after the dot)
    expect(result?.from).toBe(5);
  });

  test("an empty prefix does not auto-open unless explicitly requested", () => {
    expect(completeAt("", false)).toBeNull();
    expect(completeAt("", true)).not.toBeNull();
  });
});
