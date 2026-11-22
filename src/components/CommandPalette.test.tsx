import { describe, expect, test } from "bun:test";

import { buildCommands } from "./CommandPalette";

describe("command palette actions", () => {
  test("exposes Home and Studio navigation plus a theme toggle", () => {
    const commands = buildCommands({
      navigate: () => {},
      theme: "dark",
      onToggleTheme: () => {},
    });

    expect(commands.map((c) => c.id)).toEqual([
      "home",
      "studio",
      "toggle-theme",
    ]);
    expect(
      commands.filter((c) => c.group === "Navigation").map((c) => c.label),
    ).toEqual(["Home", "Studio"]);
  });

  test("navigation actions route to their paths", () => {
    const routes: string[] = [];
    const commands = buildCommands({
      navigate: (to) => routes.push(to),
      theme: "dark",
      onToggleTheme: () => {},
    });

    commands.find((c) => c.id === "home")?.onSelect();
    commands.find((c) => c.id === "studio")?.onSelect();
    expect(routes).toEqual(["/", "/studio"]);
  });

  test("theme action label reflects the current theme and toggles it", () => {
    let toggled = 0;
    const dark = buildCommands({
      navigate: () => {},
      theme: "dark",
      onToggleTheme: () => toggled++,
    }).find((c) => c.id === "toggle-theme");
    expect(dark?.label).toBe("Switch to light theme");

    const light = buildCommands({
      navigate: () => {},
      theme: "light",
      onToggleTheme: () => {},
    }).find((c) => c.id === "toggle-theme");
    expect(light?.label).toBe("Switch to dark theme");

    dark?.onSelect();
    expect(toggled).toBe(1);
  });

  test("lists camera commands only while a viewport is registered", () => {
    const base = {
      navigate: () => {},
      theme: "dark" as const,
      onToggleTheme: () => {},
    };
    expect(buildCommands(base).some((c) => c.group === "View")).toBe(false);

    const calls: string[] = [];
    const commands = buildCommands({
      ...base,
      view: {
        setView: (v) => calls.push(`view:${v}`),
        flipView: () => calls.push("flip"),
        frameModel: () => calls.push("frame"),
        toggleProjection: () => calls.push("projection"),
      },
    });
    const view = commands.filter((c) => c.group === "View");
    expect(view.map((c) => c.id)).toEqual([
      "view-top",
      "view-front",
      "view-right",
      "view-bottom",
      "view-back",
      "view-left",
      "view-home",
      "view-flip",
      "view-frame",
      "view-projection",
    ]);
    for (const id of [
      "view-top",
      "view-home",
      "view-flip",
      "view-frame",
      "view-projection",
    ])
      commands.find((c) => c.id === id)?.onSelect();
    expect(calls).toEqual([
      "view:top",
      "view:home",
      "flip",
      "frame",
      "projection",
    ]);
  });
});
