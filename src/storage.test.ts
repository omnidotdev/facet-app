import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { loadProject, saveProject } from "./storage";

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
