import { describe, expect, test } from "bun:test";

import { initialsFrom } from "./userInfo";

describe("initialsFrom", () => {
  test("two initials from a full name", () => {
    expect(initialsFrom({ name: "Ada Lovelace" })).toBe("AL");
  });

  test("uses first and last of a three-part name", () => {
    expect(initialsFrom({ name: "Grace Brewster Hopper" })).toBe("GH");
  });

  test("single-word name gives one initial", () => {
    expect(initialsFrom({ name: "Prince" })).toBe("P");
  });

  test("falls back to the email's first letter", () => {
    expect(initialsFrom({ email: "brian@omni.dev" })).toBe("B");
  });

  test("prefers the name over the email", () => {
    expect(initialsFrom({ name: "Ada Lovelace", email: "x@y.z" })).toBe("AL");
  });

  test("empty when nothing is available", () => {
    expect(initialsFrom({})).toBe("");
  });
});
