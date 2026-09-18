import { Outlet, createRootRoute } from "@tanstack/react-router";

/** @knipignore */
export const Route = createRootRoute({
  component: () => <Outlet />,
});
