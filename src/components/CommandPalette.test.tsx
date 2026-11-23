import { describe, expect, test } from "bun:test";

import { VIEW_KEYS } from "@/gpu/views";
import { SHORTCUT_GROUPS, buildCommands } from "./CommandPalette";

describe("command palette actions", () => {
  test("exposes Home and Studio navigation, a theme toggle, and the shortcuts list", () => {
    const commands = buildCommands({
      navigate: () => {},
      theme: "dark",
      onToggleTheme: () => {},
      onShowShortcuts: () => {},
    });

    expect(commands.map((c) => c.id)).toEqual([
      "home",
      "studio",
      "toggle-theme",
      "keyboard-shortcuts",
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
      onShowShortcuts: () => {},
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
      onShowShortcuts: () => {},
    }).find((c) => c.id === "toggle-theme");
    expect(dark?.label).toBe("Switch to light theme");

    const light = buildCommands({
      navigate: () => {},
      theme: "light",
      onToggleTheme: () => {},
      onShowShortcuts: () => {},
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
      onShowShortcuts: () => {},
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
        setRenderMode: (mode) => calls.push(`display:${mode}`),
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
      "view-display-shaded",
      "view-display-edges",
      "view-display-wireframe",
      "view-display-xray",
    ]);
    for (const id of [
      "view-top",
      "view-home",
      "view-flip",
      "view-frame",
      "view-projection",
      "view-display-xray",
    ])
      commands.find((c) => c.id === id)?.onSelect();
    expect(calls).toEqual([
      "view:top",
      "view:home",
      "flip",
      "frame",
      "projection",
      "display:xray",
    ]);
  });
  test("shortcuts action opens the list and shows the ? hotkey", () => {
    let opened = 0;
    const entry = buildCommands({
      navigate: () => {},
      theme: "dark",
      onToggleTheme: () => {},
      onShowShortcuts: () => opened++,
    }).find((c) => c.id === "keyboard-shortcuts");

    expect(entry?.group).toBe("Preferences");
    expect(entry?.shortcut).toBe("?");
    entry?.onSelect();
    expect(opened).toBe(1);
  });

  test("shortcuts list mirrors every view key the viewport binds", () => {
    const viewGroup = SHORTCUT_GROUPS.find((g) => g.title === "View");
    const keys = viewGroup?.shortcuts.map((s) => s.keys) ?? [];

    expect(keys.length).toBe(Object.keys(VIEW_KEYS).length);
    expect(keys).toContain("ctrl+1");
    expect(keys).not.toContain("Ctrl 1");
  });
});
