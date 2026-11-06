import { describe, expect, test } from "bun:test";

import { modelNameFromFile, suggestedFileName } from "./fileIo";

describe("suggestedFileName", () => {
  test("adds the .facet.ts suffix", () => {
    expect(suggestedFileName("bracket")).toBe("bracket.facet.ts");
  });

  test("keeps a human name's spaces and case", () => {
    expect(suggestedFileName("Hex Nut")).toBe("Hex Nut.facet.ts");
  });

  test("does not double the suffix when the name already has one", () => {
    expect(suggestedFileName("gear.facet.ts")).toBe("gear.facet.ts");
    expect(suggestedFileName("gear.ts")).toBe("gear.facet.ts");
  });

  test("strips filesystem-unsafe characters", () => {
    expect(suggestedFileName('a/b:c*?"<>|d')).toBe("abcd.facet.ts");
  });

  test("falls back to model for an empty or all-unsafe name", () => {
    expect(suggestedFileName("")).toBe("model.facet.ts");
    expect(suggestedFileName("///")).toBe("model.facet.ts");
  });
});

describe("modelNameFromFile", () => {
  test("drops a .facet.ts suffix", () => {
    expect(modelNameFromFile("hex-nut.facet.ts")).toBe("hex-nut");
  });

  test("drops a plain .ts suffix", () => {
    expect(modelNameFromFile("bracket.ts")).toBe("bracket");
  });

  test("leaves a name with no known suffix", () => {
    expect(modelNameFromFile("bracket")).toBe("bracket");
  });

  test("falls back to model for an empty name", () => {
    expect(modelNameFromFile(".facet.ts")).toBe("model");
  });
});
