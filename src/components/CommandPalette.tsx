import { CommandPalette as CommandPaletteShell } from "@omnidotdev/thornberry/command-palette";
import {
  GLOBAL_HOTKEYS,
  hotkeyLabel,
  useHotkeys,
} from "@omnidotdev/thornberry/use-hotkeys";
import { useNavigate } from "@tanstack/react-router";
import { Axis3d, Box, Focus, HomeIcon, MoonStar, Rotate3d } from "lucide-react";
import { useSyncExternalStore } from "react";

import { VIEW_KEYS, VIEW_LABELS } from "@/gpu/views";
import { getTheme, subscribe, toggleTheme } from "@/themeStore";
import { getViewControl, subscribeViewControl } from "@/viewControl";

import type { CommandAction } from "@omnidotdev/thornberry/command-palette";
import type { ViewName } from "@/gpu/views";
import type { Theme } from "@/theme";
import type { ViewControl } from "@/viewControl";

/** Routes the palette can jump to. */
type FacetRoute = "/" | "/studio";

interface BuildCommandsArgs {
  navigate: (to: FacetRoute) => void;
  theme: Theme;
  onToggleTheme: () => void;
  /** The Studio viewport's camera actions, when the Studio is open */
  view?: ViewControl | null;
}

const VIEW_ORDER: ViewName[] = [
  "top",
  "front",
  "right",
  "bottom",
  "back",
  "left",
  "home",
];

/** Camera commands for the Studio viewport */
const viewCommands = (view: ViewControl): CommandAction[] => [
  ...VIEW_ORDER.map(
    (name): CommandAction => ({
      id: `view-${name}`,
      label:
        name === "home"
          ? "Home view"
          : `View from ${VIEW_LABELS[name].toLowerCase()}`,
      group: "View",
      icon: Axis3d,
      keywords: ["camera", "view", "orbit", VIEW_LABELS[name].toLowerCase()],
      shortcut: VIEW_KEYS[name],
      onSelect: () => view.setView(name),
    }),
  ),
  {
    id: "view-flip",
    label: "View from the opposite side",
    group: "View",
    icon: Rotate3d,
    keywords: ["camera", "flip", "reverse"],
    shortcut: VIEW_KEYS.flip,
    onSelect: view.flipView,
  },
  {
    id: "view-frame",
    label: "Frame model",
    group: "View",
    icon: Focus,
    keywords: ["camera", "fit", "zoom", "center"],
    shortcut: VIEW_KEYS.frame,
    onSelect: view.frameModel,
  },
  {
    id: "view-projection",
    label: "Toggle orthographic / perspective",
    group: "View",
    icon: Box,
    keywords: ["camera", "ortho", "orthographic", "perspective", "projection"],
    shortcut: VIEW_KEYS.projection,
    onSelect: view.toggleProjection,
  },
];

/**
 * Build Facet's command list. Pure so it can be unit tested without rendering
 * the palette.
 */
export const buildCommands = ({
  navigate,
  theme,
  onToggleTheme,
  view,
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
  ...(view ? viewCommands(view) : []),
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
  const view = useSyncExternalStore(
    subscribeViewControl,
    getViewControl,
    getViewControl,
  );

  // App-wide theme shortcut. react-hotkeys-hook ignores form fields by default,
  // so this never fires while typing in the palette input or any other field.
  // This is now the single owner of `t` fleet-wide (Studio delegates to it)
  useHotkeys(GLOBAL_HOTKEYS.toggleTheme, toggleTheme);

  const commands = buildCommands({
    navigate: (to) => navigate({ to }),
    theme,
    onToggleTheme: toggleTheme,
    view,
  });

  return (
    <CommandPaletteShell commands={commands} placeholder="Search actions..." />
  );
};

export default CommandPalette;
