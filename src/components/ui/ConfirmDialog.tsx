import { Dialog as ArkDialog } from "@ark-ui/react";
import { useEffect, useRef } from "react";

import type { ReactNode } from "react";

interface ConfirmDialogProps {
  /** Whether the dialog is open (controlled). */
  open: boolean;
  /** Called with the next open state; close by passing false. */
  onOpenChange: (open: boolean) => void;
  /** Short question, e.g. 'Close "bracket"?'. */
  title: ReactNode;
  /** What the action does and that it cannot be undone. */
  description?: ReactNode;
  /** Confirm button label. */
  confirmLabel?: string;
  /** Cancel button label. */
  cancelLabel?: string;
  /** Style the confirm button as destructive (defaults to true). */
  destructive?: boolean;
  /** Invoked when the user confirms. */
  onConfirm: () => void;
}

/**
 * Confirmation dialog for destructive or irreversible actions, built on the
 * shared Ark UI Dialog primitive (the fleet standard) rather than a hand-rolled
 * modal. Ark provides Escape dismissal, focus trapping and restore, and the
 * data-state hooks the CSS animates on.
 *
 * Outside-press dismissal is handled here rather than via Ark's
 * closeOnInteractOutside: with a full-screen backdrop there is nothing truly
 * "outside", and letting Ark treat the opening click's tail as an outside
 * interaction closed the dialog the instant it opened. Instead the positioner's
 * empty area dismisses on a fresh press, guarded by a short grace period after
 * open so the press that opened it cannot immediately close it.
 */
const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
}: ConfirmDialogProps) => {
  const openedAt = useRef(0);
  useEffect(() => {
    if (open) openedAt.current = Date.now();
  }, [open]);

  return (
    <ArkDialog.Root
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
      closeOnInteractOutside={false}
      role="alertdialog"
    >
      {/* Dismiss on a press of the backdrop (outside the content). onPointerDown,
          not onClick, plus a short grace period after open, so the press that
          opened the dialog cannot immediately close it. The backdrop only exists
          while open, so it never blocks the page behind a closed dialog */}
      <ArkDialog.Backdrop
        className="fx-dialog-backdrop"
        onPointerDown={() => {
          if (Date.now() - openedAt.current > 150) onOpenChange(false);
        }}
      />
      <ArkDialog.Positioner className="fx-dialog-positioner">
        <ArkDialog.Content className="fx-dialog">
          <ArkDialog.Title className="fx-dialog-title">{title}</ArkDialog.Title>
          {description ? (
            <ArkDialog.Description className="fx-dialog-desc">
              {description}
            </ArkDialog.Description>
          ) : null}
          <div className="fx-dialog-actions">
            <ArkDialog.CloseTrigger className="fx-dialog-btn">
              {cancelLabel}
            </ArkDialog.CloseTrigger>
            <button
              type="button"
              className={
                destructive ? "fx-dialog-btn danger" : "fx-dialog-btn primary"
              }
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </ArkDialog.Content>
      </ArkDialog.Positioner>
    </ArkDialog.Root>
  );
};

export default ConfirmDialog;
