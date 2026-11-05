import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  loadProject,
  loadWorkspace,
  saveProject,
  saveWorkspace,
} from "./storage";

import type { SavedWorkspace } from "./storage";

/** Minimal in-memory localStorage, since bun's test env has none. */
function mockStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
    clear: () => {
      m.clear();
    },
    key: () => null,
    length: 0,
  };
}

const g = globalThis as unknown as { localStorage?: Storage };

describe("project storage", () => {
  beforeEach(() => {
    g.localStorage = mockStorage();
  });
  afterEach(() => {
    g.localStorage = undefined;
  });

  test("returns null when nothing is saved", () => {
    expect(loadProject()).toBeNull();
  });

  test("round-trips a saved project", () => {
    const project = { code: "return cube(10);", kernel: "rust", format: "3mf" };
    saveProject(project);
    expect(loadProject()).toEqual(project);
  });

  test("returns null on corrupt data", () => {
    g.localStorage?.setItem("facet:project:v1", "{ not json");
    expect(loadProject()).toBeNull();
  });

  test("does not throw when storage is unavailable", () => {
    g.localStorage = undefined;
    expect(() =>
      saveProject({ code: "x", kernel: "ts", format: "stl" }),
    ).not.toThrow();
    expect(loadProject()).toBeNull();
  });
});

describe("workspace storage", () => {
  beforeEach(() => {
    g.localStorage = mockStorage();
  });
  afterEach(() => {
    g.localStorage = undefined;
  });

  const sample = (): SavedWorkspace => ({
    tabs: [
      { id: "a", name: "Model 1", code: "return cube(1);" },
      { id: "b", name: "Bracket", code: "return cube(2);" },
    ],
    activeId: "b",
    kernel: "rust",
    format: "3mf",
  });

  test("returns null when nothing is saved", () => {
    expect(loadWorkspace()).toBeNull();
  });

  test("round-trips a saved workspace", () => {
    const ws = sample();
    saveWorkspace(ws);
    expect(loadWorkspace()).toEqual(ws);
  });

  test("migrates a legacy single project into one tab", () => {
    saveProject({ code: "return sphere(5);", kernel: "rust", format: "step" });
    const ws = loadWorkspace();
    expect(ws?.tabs).toHaveLength(1);
    expect(ws?.tabs[0]?.code).toBe("return sphere(5);");
    expect(ws?.activeId).toBe(ws?.tabs[0]?.id);
    expect(ws?.kernel).toBe("rust");
    expect(ws?.format).toBe("step");
  });

  test("repairs a dangling activeId to the first tab", () => {
    const ws = sample();
    ws.activeId = "missing";
    saveWorkspace(ws);
    expect(loadWorkspace()?.activeId).toBe("a");
  });

  test("falls back to legacy, then null, on corrupt workspace data", () => {
    g.localStorage?.setItem("facet:workspace:v1", "{ not json");
    // No legacy project either -> null
    expect(loadWorkspace()).toBeNull();
    // With a legacy project present, corrupt workspace migrates that instead
    saveProject({ code: "return cube(3);", kernel: "ts", format: "stl" });
    expect(loadWorkspace()?.tabs[0]?.code).toBe("return cube(3);");
  });

  test("ignores an empty tabs array and migrates/returns null", () => {
    g.localStorage?.setItem(
      "facet:workspace:v1",
      JSON.stringify({ tabs: [], activeId: "x", kernel: "ts", format: "stl" }),
    );
    expect(loadWorkspace()).toBeNull();
  });

  test("does not throw when storage is unavailable", () => {
    g.localStorage = undefined;
    expect(() => saveWorkspace(sample())).not.toThrow();
    expect(loadWorkspace()).toBeNull();
  });
});
