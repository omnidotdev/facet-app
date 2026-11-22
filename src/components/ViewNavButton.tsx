import { Kbd } from "@omnidotdev/thornberry/kbd";
import {
  TooltipContent,
  TooltipPositioner,
  TooltipRoot,
  TooltipTrigger,
} from "@omnidotdev/thornberry/tooltip";

import type { ReactNode } from "react";

interface ViewNavButtonProps {
  /** What the button does, shown in its tooltip and read by screen readers */
  label: string;
  /** The key that does the same thing */
  shortcut: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}

/**
 * An icon button in the viewport's view navigation, with a tooltip that says
 * what it does and which key does the same, shown on hover and on keyboard
 * focus
 */
const ViewNavButton = ({
  label,
  shortcut,
  pressed,
  onClick,
  children,
}: ViewNavButtonProps) => (
  <TooltipRoot
    openDelay={250}
    closeDelay={0}
    positioning={{ placement: "bottom", gutter: 8 }}
  >
    <TooltipTrigger
      className="view-nav-btn"
      aria-label={`${label} (${shortcut})`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </TooltipTrigger>
    <TooltipPositioner>
      <TooltipContent className="view-nav-tip">
        {label}
        <Kbd>{shortcut}</Kbd>
      </TooltipContent>
    </TooltipPositioner>
  </TooltipRoot>
);

export default ViewNavButton;
