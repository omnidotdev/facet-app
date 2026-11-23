import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_EDITOR_FRACTION,
  MIN_EDITOR_PX,
  MIN_VIEWPORT_PX,
  clampEditorFraction,
  loadEditorFraction,
  loadInvertDrag,
  loadParamsCollapsed,
  loadProject,
  loadWorkspace,
  saveEditorFraction,
  saveInvertDrag,
  saveParamsCollapsed,
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

describe("parameters panel state", () => {
  beforeEach(() => {
    g.localStorage = mockStorage();
  });
  afterEach(() => {
    g.localStorage = undefined;
  });

  test("starts expanded and remembers a collapse", () => {
    expect(loadParamsCollapsed()).toBe(false);
    saveParamsCollapsed(true);
    expect(loadParamsCollapsed()).toBe(true);
    saveParamsCollapsed(false);
    expect(loadParamsCollapsed()).toBe(false);
  });

  test("stays expanded when storage is unavailable", () => {
    g.localStorage = undefined;
    expect(loadParamsCollapsed()).toBe(false);
    expect(() => saveParamsCollapsed(true)).not.toThrow();
  });
});

describe("orbit drag direction", () => {
  beforeEach(() => {
    g.localStorage = mockStorage();
  });
  afterEach(() => {
    g.localStorage = undefined;
  });

  test("starts standard and remembers an inversion", () => {
    expect(loadInvertDrag()).toBe(false);
    saveInvertDrag(true);
    expect(loadInvertDrag()).toBe(true);
    saveInvertDrag(false);
    expect(loadInvertDrag()).toBe(false);
  });

  test("stays standard when storage is unavailable", () => {
    g.localStorage = undefined;
    expect(loadInvertDrag()).toBe(false);
    expect(() => saveInvertDrag(true)).not.toThrow();
  });
});

describe("editor and view split", () => {
  beforeEach(() => {
    g.localStorage = mockStorage();
  });
  afterEach(() => {
    g.localStorage = undefined;
  });

  test("has no saved split until one is saved, and forgets it on reset", () => {
    expect(loadEditorFraction()).toBeNull();
    saveEditorFraction(0.55);
    expect(loadEditorFraction()).toBeCloseTo(0.55);
    saveEditorFraction(null);
    expect(loadEditorFraction()).toBeNull();
  });

  test("ignores a corrupt or out-of-range saved split", () => {
    localStorage.setItem("facet:editor-width:v1", "wide");
    expect(loadEditorFraction()).toBeNull();
    localStorage.setItem("facet:editor-width:v1", "1.5");
    expect(loadEditorFraction()).toBeNull();
  });

  test("keeps both panes at their minimum widths", () => {
    const total = 1400;
    expect(clampEditorFraction(0.5, total)).toBe(0.5);
    expect(clampEditorFraction(0.05, total) * total).toBeCloseTo(MIN_EDITOR_PX);
    expect((1 - clampEditorFraction(0.98, total)) * total).toBeCloseTo(
      MIN_VIEWPORT_PX,
    );
  });

  test("gives the editor its minimum when the window fits neither", () => {
    expect(clampEditorFraction(0.5, 500) * 500).toBeCloseTo(MIN_EDITOR_PX);
  });

  test("falls back to the default for a nonsense input", () => {
    expect(clampEditorFraction(Number.NaN, 1200)).toBe(DEFAULT_EDITOR_FRACTION);
    expect(clampEditorFraction(0.5, 0)).toBe(DEFAULT_EDITOR_FRACTION);
  });
});
