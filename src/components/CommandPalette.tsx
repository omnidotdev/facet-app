import { CommandPalette as CommandPaletteShell } from "@omnidotdev/thornberry/command-palette";
import {
  GLOBAL_HOTKEYS,
  hotkeyLabel,
  useHotkeys,
} from "@omnidotdev/thornberry/use-hotkeys";
import { useNavigate } from "@tanstack/react-router";
import { Box, HomeIcon, MoonStar } from "lucide-react";
import { useSyncExternalStore } from "react";

import { getTheme, subscribe, toggleTheme } from "@/themeStore";

import type { CommandAction } from "@omnidotdev/thornberry/command-palette";
import type { Theme } from "@/theme";

/** Routes the palette can jump to. */
type FacetRoute = "/" | "/studio";

interface BuildCommandsArgs {
  navigate: (to: FacetRoute) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

/**
 * Build Facet's command list. Pure so it can be unit tested without rendering
 * the palette.
 */
export const buildCommands = ({
  navigate,
  theme,
  onToggleTheme,
}: BuildCommandsArgs): CommandAction[] => [
  {
    id: "home",
    label: "Home",
    group: "Navigation",
    icon: HomeIcon,
    onSelect: () => navigate("/"),
  },
  {
    id: "studio",
    label: "Studio",
    group: "Navigation",
    icon: Box,
    keywords: ["editor", "model", "cad"],
    onSelect: () => navigate("/studio"),
  },
  {
    id: "toggle-theme",
    label: theme === "light" ? "Switch to dark theme" : "Switch to light theme",
    group: "Preferences",
    icon: MoonStar,
    keywords: ["theme", "dark", "light", "appearance"],
    shortcut: hotkeyLabel(GLOBAL_HOTKEYS.toggleTheme),
    onSelect: onToggleTheme,
  },
];

/**
 * Global command palette (⌘/Ctrl+K). Mounted once at the app root so it works
 * on every route. Exposes Facet's navigation and the theme toggle. Built on the
 * shared Thornberry palette so every Omni app shares the same behavior; this
 * wrapper only supplies Facet's own actions. The shell owns the open state and
 * the mod+k hotkey, so no local open state is needed here.
 */
const CommandPalette = () => {
  const navigate = useNavigate();
  const theme = useSyncExternalStore(subscribe, getTheme, getTheme);

  // App-wide theme shortcut. react-hotkeys-hook ignores form fields by default,
  // so this never fires while typing in the palette input or any other field.
  // This is now the single owner of `t` fleet-wide (Studio delegates to it)
  useHotkeys(GLOBAL_HOTKEYS.toggleTheme, toggleTheme);

  const commands = buildCommands({
    navigate: (to) => navigate({ to }),
    theme,
    onToggleTheme: toggleTheme,
  });

  return (
    <CommandPaletteShell commands={commands} placeholder="Search actions..." />
  );
};

export default CommandPalette;
