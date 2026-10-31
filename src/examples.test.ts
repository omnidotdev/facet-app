import { describe, expect, test } from "bun:test";

import { defaultExample, examples, matchExample } from "./examples";

describe("matchExample", () => {
  test("names the example whose source matches exactly", () => {
    expect(matchExample(examples[defaultExample] as string)).toBe(
      defaultExample,
    );
    expect(matchExample(examples["L-bracket"] as string)).toBe("L-bracket");
  });

  test("returns null for a custom model that matches no example", () => {
    expect(matchExample("return cube(10);")).toBeNull();
  });

  test("returns null for an edited example (even a whitespace change)", () => {
    const edited = `${examples[defaultExample]}\n`;
    expect(matchExample(edited)).toBeNull();
  });
});
