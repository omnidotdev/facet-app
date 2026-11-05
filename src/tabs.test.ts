import { describe, expect, test } from "bun:test";

import {
  activeTab,
  addTab,
  closeTab,
  createTabsState,
  nameFromPrompt,
  nextAutoName,
  renameTab,
  setActive,
  setActiveCode,
} from "./tabs";

describe("createTabsState", () => {
  test("seeds a single active tab from code", () => {
    const state = createTabsState("return cube(10);");
    expect(state.tabs).toHaveLength(1);
    expect(state.activeId).toBe(state.tabs[0]!.id);
    expect(activeTab(state)?.code).toBe("return cube(10);");
    expect(activeTab(state)?.name).toBe("Model 1");
  });
});

describe("addTab", () => {
  test("adds a tab after the active one and activates it", () => {
    const base = createTabsState("a");
    const { state, id } = addTab(base, "b", "Bracket");
    expect(state.tabs).toHaveLength(2);
    expect(state.activeId).toBe(id);
    expect(activeTab(state)).toEqual({ id, name: "Bracket", code: "b" });
  });

  test("auto-names an unnamed tab one past the highest existing number", () => {
    const base = createTabsState("a"); // Model 1
    const { state } = addTab(base); // Model 2
    expect(activeTab(state)?.name).toBe("Model 2");
    const { state: state3 } = addTab(state); // Model 3
    expect(activeTab(state3)?.name).toBe("Model 3");
  });

  test("inserts directly after the active tab, not at the end", () => {
    const base = createTabsState("a");
    const { state: two, id: secondId } = addTab(base, "b");
    const { state: three } = addTab(setActive(two, base.activeId), "c");
    // Active was the first tab, so the new tab sits between first and second
    expect(three.tabs.map((t) => t.code)).toEqual(["a", "c", "b"]);
    expect(secondId).toBe(three.tabs[2]!.id);
  });
});

describe("setActive / setActiveCode", () => {
  test("setActive switches only to an open tab", () => {
    const base = createTabsState("a");
    const { state, id } = addTab(base, "b");
    const back = setActive(state, base.activeId);
    expect(back.activeId).toBe(base.activeId);
    // Unknown id is a no-op
    expect(setActive(back, "nope").activeId).toBe(base.activeId);
    expect(id).toBe(state.activeId);
  });

  test("setActiveCode updates only the active tab", () => {
    const base = createTabsState("a");
    const { state } = addTab(base, "b");
    const edited = setActiveCode(state, "b2");
    expect(activeTab(edited)?.code).toBe("b2");
    // the other tab is untouched
    expect(edited.tabs.find((t) => t.id === base.activeId)?.code).toBe("a");
  });
});

describe("renameTab", () => {
  test("renames a tab", () => {
    const base = createTabsState("a");
    const renamed = renameTab(base, base.activeId, "  Flange  ");
    expect(activeTab(renamed)?.name).toBe("Flange");
  });

  test("ignores an empty name", () => {
    const base = createTabsState("a");
    expect(renameTab(base, base.activeId, "   ").tabs[0]!.name).toBe("Model 1");
  });
});

describe("closeTab", () => {
  test("activates the left neighbour when closing the active tab", () => {
    const base = createTabsState("a");
    const { state: two } = addTab(base, "b");
    const { state: three } = addTab(two, "c"); // active is c (rightmost)
    const closed = closeTab(three, three.activeId);
    expect(closed.tabs.map((t) => t.code)).toEqual(["a", "b"]);
    // left neighbour of c was b
    expect(activeTab(closed)?.code).toBe("b");
  });

  test("keeps the active tab when closing a different one", () => {
    const base = createTabsState("a");
    const { state: two, id: bId } = addTab(base, "b"); // active b
    const closed = closeTab(two, base.activeId); // close a
    expect(closed.tabs.map((t) => t.code)).toEqual(["b"]);
    expect(closed.activeId).toBe(bId);
  });

  test("closing the last tab leaves one fresh blank tab", () => {
    const base = createTabsState("return cube(1);");
    const closed = closeTab(base, base.activeId);
    expect(closed.tabs).toHaveLength(1);
    expect(activeTab(closed)?.code).toBe("");
    expect(activeTab(closed)?.name).toBe("Model 1");
  });

  test("an unknown id is a no-op", () => {
    const base = createTabsState("a");
    expect(closeTab(base, "nope")).toBe(base);
  });
});

describe("nextAutoName", () => {
  test("ignores non-auto names when numbering", () => {
    let state = createTabsState("a"); // Model 1
    state = addTab(state, "b", "Bracket").state;
    expect(nextAutoName(state)).toBe("Model 2");
  });
});

describe("nameFromPrompt", () => {
  test("collapses whitespace and keeps short prompts whole", () => {
    expect(nameFromPrompt("  a   cube  ")).toBe("a cube");
  });

  test("truncates a long prompt with an ellipsis", () => {
    const name = nameFromPrompt("a 20mm cube with a 6mm hole through it", 24);
    expect(name.length).toBeLessThanOrEqual(24);
    expect(name.endsWith("…")).toBe(true);
  });
});
