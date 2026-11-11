import { useEffect, useRef, useState } from "react";

import { importArtFromUrl } from "@/ai/importClient";
import { buildImportSnippet, normalizePathData } from "@/facet/importArt";
import { traceImageData } from "@/facet/traceImage";

import type { RefObject } from "react";
import type { StudioHandle } from "@/FacetStudio";

/**
 * "Import art" toolbar control: bring an SVG or image (file or URL) into the
 * Studio as an extruded part. An SVG is parsed directly; a raster (PNG/JPG/...)
 * is traced to contours in the browser. The art is normalized (scaled + centered)
 * and dropped into a fresh tab as a runnable `importSvg` snippet.
 *
 * File import works offline. URL import goes through the gateway's guarded proxy
 * (the browser can't fetch cross-origin art), so it needs a configured gateway
 * and a signed-in user; the row is hidden when no gateway is set.
 */

const RASTER_TRACE_MAX_DIM = 512;

/** Decode a raster image, flatten onto white, and trace it to a path `d`. */
async function rasterToPathData(src: string): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(
    1,
    RASTER_TRACE_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight, 1),
  );
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image tracing is not available in this browser.");
  // Flatten transparency onto white so it reads as background, not ink
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const d = traceImageData({ width: w, height: h, data }, { minArea: 6 });
  if (!d) throw new Error("No shape could be traced from that image.");
  return d;
}

/** A short tab name from a file name or URL. */
function importName(source: string): string {
  const base = source.split(/[/\\]/).pop() ?? source;
  const stripped = base.split("?")[0].replace(/\.[a-z0-9]+$/i, "");
  return stripped.slice(0, 40) || "Imported art";
}

const ImportArtButton = ({
  handle,
}: {
  handle: RefObject<StudioHandle | null>;
}) => {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasGateway = Boolean(import.meta.env.VITE_FACET_API_URL);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  /** Normalize art (SVG text or a traced path) and load it into a fresh tab. */
  const loadArt = async (
    art: { svg: string } | { pathData: string },
    source: string,
  ) => {
    const input = "svg" in art ? art.svg : art.pathData;
    const normalized = normalizePathData(input);
    const snippet = buildImportSnippet(normalized, source);
    const studio = handle.current;
    if (!studio) throw new Error("The Studio is not ready yet.");
    studio.openGeneratedTab(importName(source));
    await studio.loadCode(snippet);
  };

  /** Run an import action with shared busy/error handling. */
  const runImport = async (action: () => Promise<void>) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await action();
      setOpen(false);
      setUrl("");
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Could not import that art.",
      );
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File) =>
    runImport(async () => {
      const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
      if (isSvg) {
        await loadArt({ svg: await file.text() }, file.name);
        return;
      }
      const src = URL.createObjectURL(file);
      try {
        await loadArt({ pathData: await rasterToPathData(src) }, file.name);
      } finally {
        URL.revokeObjectURL(src);
      }
    });

  const onUrl = () =>
    runImport(async () => {
      const trimmed = url.trim();
      if (!trimmed) throw new Error("Enter a URL to import.");
      const result = await importArtFromUrl(trimmed);
      if (result.kind === "svg") {
        await loadArt({ svg: result.svg }, trimmed);
        return;
      }
      const src = `data:${result.contentType};base64,${result.dataBase64}`;
      await loadArt({ pathData: await rasterToPathData(src) }, trimmed);
    });

  return (
    <div className="examples-menu" ref={ref}>
      <button
        type="button"
        className="examples-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Import an SVG or image as an extruded part"
      >
        Import{" "}
        <span className="examples-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="examples-dropdown import-dropdown" role="menu">
          <input
            ref={fileRef}
            type="file"
            accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp,image/gif,image/bmp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onFile(file);
            }}
          />
          <button
            type="button"
            className="examples-item"
            role="menuitem"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            From file (SVG or image)…
          </button>
          {hasGateway ? (
            <div className="import-url-row">
              <input
                type="url"
                className="import-url-input"
                placeholder="Paste an SVG or image URL"
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onUrl();
                }}
              />
              <button
                type="button"
                className="icon-btn"
                disabled={busy || url.trim().length === 0}
                onClick={onUrl}
              >
                {busy ? "…" : "Import"}
              </button>
            </div>
          ) : null}
          <p className="import-hint">
            {busy
              ? "Importing…"
              : "SVG is parsed directly; images are traced to an outline."}
          </p>
          {error ? <p className="import-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
};

export default ImportArtButton;
