import { useEffect, useRef, useState } from "react";

/**
 * A labeled "Examples" dropdown for the Studio header. Replaces a bare
 * <select> that showed the loaded example as its value (which read as state,
 * not an action). This reads as a menu of demos to open; the active example is
 * marked with aria-current so a loaded demo is still discoverable. Selecting an
 * entry opens it in a new tab (the caller's loadExample), never overwriting the
 * current model.
 */
const ExamplesMenu = ({
  names,
  current,
  onSelect,
}: {
  names: string[];
  current: string;
  onSelect: (name: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on an outside click, like a native menu
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div className="examples-menu" ref={ref}>
      <button
        type="button"
        className="examples-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Open an example model"
      >
        Examples{" "}
        <span className="examples-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="examples-dropdown" role="menu">
          {names.map((name) => (
            <button
              key={name}
              type="button"
              className="examples-item"
              role="menuitem"
              aria-current={name === current}
              onClick={() => {
                setOpen(false);
                onSelect(name);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default ExamplesMenu;
