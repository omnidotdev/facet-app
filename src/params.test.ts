import { describe, expect, test } from "bun:test";

import { ParamStore } from "./params";

/** Simulate a model run: begin, then the model's param calls. */
const run = (
  store: ParamStore,
  model: (p: ReturnType<ParamStore["api"]>) => void,
) => {
  store.begin();
  model(store.api());
};

describe("ParamStore.number", () => {
  test("returns the default on first run and persists an edited value", () => {
    const store = new ParamStore();
    run(store, (p) => {
      expect(p.number("h", { min: 0, max: 40, default: 5 })).toBe(5);
    });
    store.set("h", 12);
    run(store, (p) => {
      expect(p.number("h", { min: 0, max: 40, default: 5 })).toBe(12);
    });
  });
});

describe("ParamStore.boolean", () => {
  test("defaults to false, honors an explicit default, and persists edits", () => {
    const store = new ParamStore();
    run(store, (p) => {
      expect(p.boolean("lid")).toBe(false);
      expect(p.boolean("solid", { default: true })).toBe(true);
    });
    store.set("lid", true);
    run(store, (p) => {
      expect(p.boolean("lid")).toBe(true);
    });
  });

  test("declares a boolean control", () => {
    const store = new ParamStore();
    run(store, (p) => p.boolean("lid", { default: true }));
    expect(store.list()).toEqual([
      { kind: "boolean", name: "lid", value: true },
    ]);
  });
});

describe("ParamStore.enum / select", () => {
  test("defaults to the first option or a valid explicit default", () => {
    const store = new ParamStore();
    run(store, (p) => {
      expect(p.enum("shape", { options: ["square", "hex"] })).toBe("square");
      expect(p.enum("mode", { options: ["a", "b", "c"], default: "b" })).toBe(
        "b",
      );
    });
  });

  test("ignores an invalid explicit default (falls to first option)", () => {
    const store = new ParamStore();
    run(store, (p) => {
      expect(p.enum("s", { options: ["x", "y"], default: "z" })).toBe("x");
    });
  });

  test("persists a stored value only while it is still a valid option", () => {
    const store = new ParamStore();
    run(store, (p) => p.enum("s", { options: ["x", "y"] }));
    store.set("s", "y");
    run(store, (p) => {
      expect(p.enum("s", { options: ["x", "y"] })).toBe("y");
    });
    // the option list changes and no longer contains the stored value
    run(store, (p) => {
      expect(p.enum("s", { options: ["x", "z"] })).toBe("x");
    });
  });

  test("select is an alias for enum", () => {
    const store = new ParamStore();
    run(store, (p) => {
      expect(p.select("s", { options: ["x", "y"], default: "y" })).toBe("y");
    });
    expect(store.list()[0]).toMatchObject({ kind: "enum", name: "s" });
  });
});

describe("ParamStore.reset", () => {
  test("re-seeds from declared defaults, dropping carried-over values", () => {
    const store = new ParamStore();
    // example A tunes height to 12
    run(store, (p) => p.number("height", { min: 0, max: 40, default: 5 }));
    store.set("height", 12);
    // switching examples resets, so example B gets its own default, not 12
    store.reset();
    run(store, (p) => {
      expect(p.number("height", { min: 0, max: 40, default: 5 })).toBe(5);
    });
  });
});

describe("ParamStore.signature", () => {
  test("distinguishes control kinds and enum option sets", () => {
    const a = new ParamStore();
    run(a, (p) => {
      p.number("h", { min: 0, max: 10 });
      p.boolean("lid");
      p.enum("s", { options: ["x", "y"] });
    });
    const b = new ParamStore();
    run(b, (p) => {
      p.number("h", { min: 0, max: 10 });
      p.boolean("lid");
      p.enum("s", { options: ["x", "z"] });
    });
    // same names/kinds but a different enum option set -> different signature
    expect(a.signature()).not.toBe(b.signature());
  });
});

describe("ParamStore.api", () => {
  test("exposes number, boolean, enum, and select", () => {
    const api = new ParamStore().api();
    expect(typeof api.number).toBe("function");
    expect(typeof api.boolean).toBe("function");
    expect(typeof api.enum).toBe("function");
    expect(typeof api.select).toBe("function");
  });
});
