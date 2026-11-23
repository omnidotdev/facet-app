import { useEffect, useRef, useState } from "react";

import {
  DEFAULT_EDITOR_FRACTION,
  clampEditorFraction,
  loadEditorFraction,
  saveEditorFraction,
} from "@/storage";

import type { KeyboardEvent, PointerEvent, RefObject } from "react";

/** The CSS custom property the Studio grid sizes the editor column from */
const FRACTION_VAR = "--editor-fraction";

/** How far one arrow key press moves the split, as a share of the width */
const KEY_STEP = 0.02;

interface PaneSplitterProps {
  /** The two-column grid holding the editor and the 3D view */
  container: RefObject<HTMLElement | null>;
}

/**
 * The divider between the code editor and the 3D view. Drag it (or focus it
 * and use the arrow keys) to give either pane more room; double-click resets
 * the split. The split is saved per browser, like the other view preferences.
 *
 * While dragging it writes a CSS variable on the grid directly instead of
 * going through React state, so the panes resize every frame without
 * re-rendering the Studio
 */
const PaneSplitter = ({ container }: PaneSplitterProps) => {
  const [fraction, setFraction] = useState(
    () => loadEditorFraction() ?? DEFAULT_EDITOR_FRACTION,
  );
  const [dragging, setDragging] = useState(false);
  const live = useRef(fraction);

  const apply = (next: number) => {
    live.current = next;
    container.current?.style.setProperty(FRACTION_VAR, `${next * 100}%`);
  };

  // Apply the saved split once the grid is mounted
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the initial split is applied here; later changes go through apply()
  useEffect(() => {
    apply(fraction);
  }, []);

  const widthOf = () => container.current?.getBoundingClientRect().width ?? 0;

  const commit = (next: number) => {
    const clamped = clampEditorFraction(next, widthOf());
    apply(clamped);
    setFraction(clamped);
    saveEditorFraction(clamped);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !container.current) return;
    const rect = container.current.getBoundingClientRect();
    apply(
      clampEditorFraction((e.clientX - rect.left) / rect.width, rect.width),
    );
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    commit(live.current);
  };

  const reset = () => {
    apply(DEFAULT_EDITOR_FRACTION);
    setFraction(DEFAULT_EDITOR_FRACTION);
    saveEditorFraction(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") commit(live.current - KEY_STEP);
    else if (e.key === "ArrowRight") commit(live.current + KEY_STEP);
    else if (e.key === "Home") commit(0);
    else if (e.key === "End") commit(1);
    else if (e.key === "Enter") reset();
    else return;
    e.preventDefault();
  };

  return (
    // A focusable separator is the ARIA pattern for a pane splitter: it is a
    // widget with a value, so it takes focus and keys
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take focus or keys, and a focusable separator is the ARIA window-splitter pattern
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize the code editor and 3D view"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      title="Drag to resize. Double-click to reset"
      className="pane-splitter"
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
    />
  );
};

export default PaneSplitter;
