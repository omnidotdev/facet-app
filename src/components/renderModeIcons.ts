import { BoxSelect, Cuboid, Grid3x3, ScanEye } from "lucide-react";

import type { RenderMode } from "@/gpu/renderMode";

/** The icon each display mode shows, in the palette and on the view controls */
export const RENDER_MODE_ICONS: Record<RenderMode, typeof Cuboid> = {
  shaded: Cuboid,
  edges: BoxSelect,
  wireframe: Grid3x3,
  xray: ScanEye,
};
