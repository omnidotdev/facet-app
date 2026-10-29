import { Outlet, createRootRoute } from "@tanstack/react-router";

import CommandPalette from "@/components/CommandPalette";

/** @knipignore */
export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <CommandPalette />
      <Outlet />
    </>
  );
}
