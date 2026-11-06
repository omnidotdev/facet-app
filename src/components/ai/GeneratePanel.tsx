import { useEffect, useRef, useState } from "react";

import { fetchCapabilities } from "@/ai/capabilities";
import {
  PANEL_COPY,
  PROMPT_SUGGESTIONS,
  SYNAPSE_KEY_URL,
  billingHubUrl,
  classifyGenerateError,
  formatGeneratedToast,
  formatSpentNote,
} from "@/ai/panelState";
import { generateAndRun } from "@/ai/repair";
import { isAuthConfigured, signOut } from "@/lib/auth/session";
import { useAuthSession } from "@/lib/auth/useAuthSession";
import { nameFromPrompt } from "@/tabs";

import type { RefObject } from "react";
import type { ModelRunner } from "@/ai/repair";
import type { StudioHandle } from "@/FacetStudio";

// Kept out of our servers: a BYOK Synapse key lives only in this browser. Used
// only in the no-auth (local/dev) fallback; signed-in users never paste a key
const BYOK_STORAGE_KEY = "facet:ai-byok-key:v1";

// Funnel out-of-credits users to the shared Omni billing hub for Facet Pro.
// Null when VITE_ACCOUNT_URL is unset, so the CTA is simply omitted
const UPGRADE_URL = billingHubUrl(import.meta.env.VITE_ACCOUNT_URL);

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
 * "Describe a part" generation. A toolbar button opens a focused modal (a bottom
 * sheet on a phone) that turns a plain-English prompt into Facet code via the
 * gateway, loads it into the editor, runs it through the Studio's own run path,
 * and repairs on a kernel error.
 *
 * Sign-in-first: identity lives in the header account control, not here. When
 * sign-in is configured (prod), this panel shows only to signed-in users, and a
 * managed request reaches Synapse under the user's own identity (their keys,
 * plan, and budget) with no key ever pasted. When sign-in is NOT configured
 * (local/dev), the panel offers a BYOK Synapse key as the only path, so local
 * modeling and offline testing still work. Local modeling stays anonymous either
 * way.
 *
 * Renders nothing when no gateway is configured, so the static app still works,
 * and nothing here reads the auth session or touches the network in that case.
 */
const GeneratePanel = ({ handle }: GeneratePanelProps) => {
  // No gateway, no button, and no auth session read
  if (!import.meta.env.VITE_FACET_API_URL) return null;
  return <GeneratePanelInner handle={handle} />;
};

const GeneratePanelInner = ({ handle }: GeneratePanelProps) => {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Credits billed by a failed-but-charged managed attempt, shown in the dialog
  const [spent, setSpent] = useState<string | null>(null);
  // A short confirmation shown after the dialog closes on a successful generate
  const [toast, setToast] = useState<string | null>(null);
  const [byokOpen, setByokOpen] = useState(false);
  const [byokKey, setByokKey] = useState(loadByokKey);
  // Set when a managed call comes back 402, to surface the upgrade funnel
  const [outOfCredits, setOutOfCredits] = useState(false);
  // null while unknown; the gateway says whether this user may use managed
  // generation (the server's env allowlist), so the panel is shown only to
  // permitted users rather than to everyone with a 403 after the fact
  const [managedAllowed, setManagedAllowed] = useState<boolean | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { signedIn } = useAuthSession();

  const authConfigured = isAuthConfigured();

  // Probe the gateway's capability for the signed-in user; re-run on sign-in
  // state changes. Signed out means no managed access
  useEffect(() => {
    if (!authConfigured) return;
    if (!signedIn) {
      setManagedAllowed(false);
      return;
    }
    let active = true;
    setManagedAllowed(null);
    fetchCapabilities().then((caps) => {
      if (active) setManagedAllowed(caps.managedGeneration);
    });
    return () => {
      active = false;
    };
  }, [authConfigured, signedIn]);
  // BYOK is the no-auth (local/dev) fallback only; signed-in prod users never
  // paste a key (their Synapse identity drives generation)
  const byokAllowed = !authConfigured;
  const hasByok = byokAllowed && byokKey.trim().length > 0;
  const canGenerate = authConfigured ? signedIn : hasByok;

  const close = () => setOpen(false);

  // While open: focus the prompt and let Escape dismiss, like a native dialog
  useEffect(() => {
    if (!open) return;
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // The success confirmation is transient: clear it after a few seconds
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const onGenerate = async () => {
    const studio = handle.current;
    const trimmed = prompt.trim();
    if (!studio || busy || !trimmed || !canGenerate) return;

    setBusy(true);
    setError(null);
    setSpent(null);
    setOutOfCredits(false);

    // Generate into a fresh tab so the current model is never overwritten. The
    // tab is created lazily on the first code that comes back, so a 401/402
    // before any output leaves no empty tab behind
    let createdTab = false;
    const runner: ModelRunner = {
      getCode: () => studio.getCode(),
      loadCode: (code) => {
        if (!createdTab) {
          createdTab = true;
          studio.openGeneratedTab(nameFromPrompt(trimmed));
        }
        return studio.loadCode(code);
      },
    };

    const result = await generateAndRun(trimmed, runner, {
      ...(hasByok ? { byokKey } : {}),
      restorePriorOnFailure: false,
    });

    if (result.status === "ok") {
      setOutOfCredits(false);
      setError(null);
      setSpent(null);
      setToast(
        formatGeneratedToast(result.usage.credits, result.repairs, hasByok),
      );
      setPrompt("");
      close();
      setBusy(false);
      return;
    }

    // A failed managed attempt may still have billed; surface what it cost so
    // the spend is never silent (BYOK reports zero, so nothing shows)
    setSpent(
      result.usage && result.usage.credits > 0
        ? formatSpentNote(result.usage.credits)
        : null,
    );
    switch (classifyGenerateError(result.httpStatus)) {
      case "signIn":
        // The session expired or was revoked mid-use. Clear it so the header
        // account control flips back to "Sign in"; this panel then hides until
        // the user signs in again (no in-panel sign-in anymore)
        close();
        void signOut();
        break;
      case "outOfCredits":
        setError(PANEL_COPY.outOfCredits);
        setOutOfCredits(true);
        break;
      default:
        setError(result.message);
    }
    setBusy(false);
  };

  // Sign-in-first and allowlist-gated: when sign-in is configured (prod), the
  // panel appears only for a signed-in user the gateway says may use managed
  // generation (its env allowlist), so the gated "describe a part" surface is
  // not shown to everyone with a 403 after the fact. Signed-out and
  // not-yet-known states hide it. With no auth configured (local/dev), BYOK is
  // the path, so the panel stays available. The gate is still enforced
  // server-side regardless of what the UI shows
  if (authConfigured && !(signedIn && managedAllowed)) return null;

  return (
    <>
      <button
        type="button"
        className="ai-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className="ai-title">Describe a part</span>
        <span className="ai-badge">Beta</span>
      </button>

      {open ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; dismissal also via the Escape key (global listener) and the close button
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismissal is the global Escape listener plus the close button, not a handler on the backdrop
        <div
          className="ai-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Describe a part"
        >
          <div className="ai-modal">
            <div className="ai-modal-head">
              <span className="ai-title">Describe a part</span>
              <span className="ai-badge">Beta</span>
              <button
                type="button"
                className="ai-modal-close"
                onClick={close}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p className="ai-help ai-router-note">
              Generation runs through{" "}
              <a
                href={SYNAPSE_KEY_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Synapse
              </a>
              , Omni's AI router.
            </p>

            <form
              className="ai-form"
              onSubmit={(e) => {
                e.preventDefault();
                void onGenerate();
              }}
            >
              <textarea
                ref={textareaRef}
                className="ai-textarea"
                placeholder="e.g. a 20mm cube with a 6mm hole through the middle"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                disabled={busy}
              />
              <div className="ai-actions">
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || !canGenerate || prompt.trim().length === 0}
                >
                  {busy ? "Generating…" : "Generate"}
                </button>
              </div>
            </form>

            {prompt.trim().length === 0 ? (
              <div className="ai-suggestions">
                <span className="ai-suggestions-label">Try</span>
                {PROMPT_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="ai-suggestion"
                    onClick={() => {
                      setPrompt(suggestion);
                      textareaRef.current?.focus();
                    }}
                    disabled={busy}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}

            {error ? (
              <div className="ai-error" role="alert">
                {error}
              </div>
            ) : null}

            {spent ? <p className="ai-spent">{spent}</p> : null}

            {outOfCredits && UPGRADE_URL ? (
              <a
                className="ai-upgrade"
                href={UPGRADE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Upgrade workspace
              </a>
            ) : null}

            {byokAllowed ? (
              <div className="ai-byok">
                <button
                  type="button"
                  className="ai-byok-toggle"
                  onClick={() => setByokOpen((isOpen) => !isOpen)}
                  aria-expanded={byokOpen}
                >
                  {byokOpen ? "▾" : "▸"} {PANEL_COPY.byokToggle}
                </button>
                {byokOpen ? (
                  <div className="ai-byok-body">
                    <input
                      type="password"
                      className="ai-byok-input"
                      placeholder={PANEL_COPY.byokPlaceholder}
                      value={byokKey}
                      onChange={(e) => {
                        setByokKey(e.target.value);
                        persistByokKey(e.target.value);
                      }}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="ai-help">
                      Add your own{" "}
                      <a
                        href={SYNAPSE_KEY_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Synapse key
                      </a>{" "}
                      to generate. The key is kept only in this browser and sent
                      over TLS to our gateway for each request, never stored on
                      our servers.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {toast ? (
        <output className="ai-toast" aria-live="polite">
          {toast}
        </output>
      ) : null}
    </>
  );
};

export default GeneratePanel;
