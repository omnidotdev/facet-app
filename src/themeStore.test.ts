import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { getTheme, setTheme, subscribe, toggleTheme } from "./themeStore";

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

const g = globalThis as unknown as {
  localStorage?: Storage;
  document?: { documentElement: { dataset: Record<string, string> } };
};

describe("theme store", () => {
  beforeEach(() => {
    g.localStorage = mockStorage();
    g.document = { documentElement: { dataset: {} } };
    // Normalize to a known starting point (module state persists across tests).
    setTheme("dark");
  });
  afterEach(() => {
    g.localStorage = undefined;
    g.document = undefined;
  });

  test("toggle flips light <-> dark", () => {
    setTheme("light");
    expect(getTheme()).toBe("light");
    toggleTheme();
    expect(getTheme()).toBe("dark");
    toggleTheme();
    expect(getTheme()).toBe("light");
  });

  test("stamps the theme on the document element", () => {
    setTheme("light");
    expect(g.document?.documentElement.dataset.theme).toBe("light");
    setTheme("dark");
    expect(g.document?.documentElement.dataset.theme).toBe("dark");
  });

  test("notifies subscribers on change and stops after unsubscribe", () => {
    const seen: string[] = [];
    const unsubscribe = subscribe((theme) => seen.push(theme));
    setTheme("light");
    setTheme("dark");
    expect(seen).toEqual(["light", "dark"]);
    unsubscribe();
    setTheme("light");
    expect(seen).toEqual(["light", "dark"]);
  });

  test("persists the choice via localStorage", () => {
    setTheme("light");
    expect(g.localStorage?.getItem("facet-theme")).toBe("light");
    setTheme("dark");
    expect(g.localStorage?.getItem("facet-theme")).toBe("dark");
  });
});
