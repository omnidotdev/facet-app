import { useState } from "react";

import { generateAndRun } from "@/ai/repair";

import type { RefObject } from "react";
import type { StudioHandle } from "@/FacetStudio";

// Kept out of our servers: the BYOK key lives only in this browser
const BYOK_STORAGE_KEY = "facet:ai-byok-key:v1";

interface GeneratePanelProps {
  /** The Studio's editor + run handle, populated after its setup effect runs. */
  handle: RefObject<StudioHandle | null>;
}

/** Read the saved BYOK key, tolerating private mode or disabled storage. */
function loadByokKey(): string {
  try {
    return localStorage.getItem(BYOK_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Persist (or clear) the BYOK key, tolerating private mode or disabled storage. */
function persistByokKey(value: string): void {
  try {
    if (value) localStorage.setItem(BYOK_STORAGE_KEY, value);
    else localStorage.removeItem(BYOK_STORAGE_KEY);
  } catch {
    // Private mode or storage disabled; the key still works for this session
  }
}

/**
 * "Describe a part" panel. Turns a plain-English prompt into Facet code via the
 * gateway, loads it into the editor, runs it through the Studio's own run path,
 * and repairs on a kernel error. Managed generation is gated and credit-metered
 * (hence the Beta badge); BYOK is billed to the caller and costs us nothing.
 *
 * Renders nothing when no gateway is configured, so the static app still works.
 */
const GeneratePanel = ({ handle }: GeneratePanelProps) => {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [byokOpen, setByokOpen] = useState(false);
  const [byokKey, setByokKey] = useState(loadByokKey);

  // No gateway, no panel; local modeling is unaffected
  if (!import.meta.env.VITE_FACET_API_URL) return null;

  const onGenerate = async () => {
    const runner = handle.current;
    const trimmed = prompt.trim();
    if (!runner || busy || !trimmed) return;

    setBusy(true);
    setError(null);
    setUsage(null);

    const result = await generateAndRun(
      trimmed,
      runner,
      byokKey ? { byokKey } : {},
    );

    if (result.status === "ok") {
      const n = result.usage.credits;
      setUsage(`~${n} credit${n === 1 ? "" : "s"}`);
    } else {
      setError(result.message);
    }
    setBusy(false);
  };

  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <span className="ai-title">Describe a part</span>
        <span className="ai-badge">Beta</span>
      </div>

      <form
        className="ai-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onGenerate();
        }}
      >
        <textarea
          className="ai-textarea"
          placeholder="e.g. a 20mm cube with a 6mm hole through the middle"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          disabled={busy}
        />
        <div className="ai-actions">
          <button
            type="submit"
            className="primary"
            disabled={busy || prompt.trim().length === 0}
          >
            {busy ? "Generating…" : "Generate"}
          </button>
          {usage && !error ? <span className="ai-usage">{usage}</span> : null}
        </div>
      </form>

      {error ? (
        <div className="ai-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="ai-byok">
        <button
          type="button"
          className="ai-byok-toggle"
          onClick={() => setByokOpen((open) => !open)}
          aria-expanded={byokOpen}
        >
          {byokOpen ? "▾" : "▸"} Use your own key
        </button>
        {byokOpen ? (
          <div className="ai-byok-body">
            <input
              type="password"
              className="ai-byok-input"
              placeholder="Provider API key"
              value={byokKey}
              onChange={(e) => {
                setByokKey(e.target.value);
                persistByokKey(e.target.value);
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="ai-help">
              A key entered here is sent to our gateway to call the provider on
              your behalf and is not stored on our servers. It is kept only in
              this browser.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default GeneratePanel;
