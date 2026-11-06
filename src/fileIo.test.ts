import { describe, expect, test } from "bun:test";

import {
  modelNameFromFile,
  suggestedFileName,
  validateModelFile,
} from "./fileIo";

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

describe("validateModelFile", () => {
  const code = 'return cube(10);\nconst x = param.number("w");';

  test("accepts a .facet.ts text model", () => {
    const r = validateModelFile("bracket.facet.ts", code);
    expect(r).toEqual({ ok: true, name: "bracket", code });
  });

  test("accepts a plain .ts model", () => {
    const r = validateModelFile("gear.ts", code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe("gear");
  });

  test("rejects a non-.ts extension (e.g. an image)", () => {
    const r = validateModelFile("photo.png", code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Facet model/);
  });

  test("rejects a file with no known extension", () => {
    expect(validateModelFile("README", code).ok).toBe(false);
  });

  test("rejects binary content even if named .ts (image renamed)", () => {
    // PNG magic bytes decoded as text include NUL and control bytes
    const pngish = "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00";
    const r = validateModelFile("sneaky.ts", pngish);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a text model/);
  });

  test("rejects a NUL byte in otherwise-texty content", () => {
    expect(validateModelFile("x.ts", "return cube(1);\u0000").ok).toBe(false);
  });

  test("allows tabs, newlines, and carriage returns", () => {
    expect(validateModelFile("x.ts", "\treturn\r\n cube(1);").ok).toBe(true);
  });

  test("rejects an oversized file", () => {
    const huge = "a".repeat(512 * 1024 + 1);
    const r = validateModelFile("big.ts", huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too large/);
  });
});
