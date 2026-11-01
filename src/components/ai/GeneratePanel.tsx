import { useState } from "react";

import {
  billingHubUrl,
  classifyGenerateError,
  resolvePanelMode,
} from "@/ai/panelState";
import { generateAndRun } from "@/ai/repair";
import authClient from "@/lib/auth/authClient";
import { isAuthConfigured, signIn, signOut } from "@/lib/auth/session";

import type { RefObject } from "react";
import type { StudioHandle } from "@/FacetStudio";

// Kept out of our servers: the BYOK key lives only in this browser
const BYOK_STORAGE_KEY = "facet:ai-byok-key:v1";

// Generic, user-safe copy. The managed path spends our key, so it needs an Omni
// identity; BYOK needs none. Terminology is "workspace", never "organization"
const SIGN_IN_PROMPT =
  "Sign in to use managed generation, or add your own key below.";
const OUT_OF_CREDITS =
  "You are out of AI credits for this month. Upgrade your workspace plan for more, or add your own key below.";

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
 * "Describe a part" panel. Turns a plain-English prompt into Facet code via the
 * gateway, loads it into the editor, runs it through the Studio's own run path,
 * and repairs on a kernel error. Managed generation needs an Omni identity and
 * is credit-metered (hence the Beta badge); BYOK is billed to the caller and
 * needs no account. Local modeling stays fully anonymous either way.
 *
 * Renders nothing when no gateway is configured, so the static app still works.
 * The gateway check gates the inner component so that, with no gateway, nothing
 * here reads the auth session or touches the network: local modeling is
 * untouched and fully anonymous.
 */
const GeneratePanel = ({ handle }: GeneratePanelProps) => {
  // No gateway, no panel, and no auth session read
  if (!import.meta.env.VITE_FACET_API_URL) return null;
  return <GeneratePanelInner handle={handle} />;
};

const GeneratePanelInner = ({ handle }: GeneratePanelProps) => {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [byokOpen, setByokOpen] = useState(false);
  const [byokKey, setByokKey] = useState(loadByokKey);
  // Set when a managed call comes back 401, to surface sign-in even if the
  // session looked valid (an expired or revoked token)
  const [needSignIn, setNeedSignIn] = useState(false);
  // Set when a managed call comes back 402, to surface the upgrade funnel
  const [outOfCredits, setOutOfCredits] = useState(false);

  const { data: session } = authClient.useSession();

  const authConfigured = isAuthConfigured();
  const signedIn = Boolean(session?.session);
  const hasByok = byokKey.trim().length > 0;
  const baseMode = resolvePanelMode({ authConfigured, signedIn, hasByok });
  const mode = needSignIn && authConfigured ? "signIn" : baseMode;

  const onGenerate = async () => {
    const runner = handle.current;
    const trimmed = prompt.trim();
    if (!runner || busy || !trimmed || mode !== "generate") return;

    setBusy(true);
    setError(null);
    setUsage(null);
    setOutOfCredits(false);

    const result = await generateAndRun(
      trimmed,
      runner,
      byokKey ? { byokKey } : {},
    );

    if (result.status === "ok") {
      const n = result.usage.credits;
      setUsage(`~${n} credit${n === 1 ? "" : "s"}`);
      setNeedSignIn(false);
      setOutOfCredits(false);
    } else {
      switch (classifyGenerateError(result.httpStatus)) {
        case "signIn":
          setNeedSignIn(true);
          setError(SIGN_IN_PROMPT);
          break;
        case "outOfCredits":
          setError(OUT_OF_CREDITS);
          setOutOfCredits(true);
          break;
        default:
          setError(result.message);
      }
    }
    setBusy(false);
  };

  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <span className="ai-title">Describe a part</span>
        <span className="ai-badge">Beta</span>
        {signedIn && authConfigured ? (
          <button
            type="button"
            className="ai-signout"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        ) : null}
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
          {mode === "generate" ? (
            <button
              type="submit"
              className="primary"
              disabled={busy || prompt.trim().length === 0}
            >
              {busy ? "Generating…" : "Generate"}
            </button>
          ) : null}
          {mode === "signIn" ? (
            <button
              type="button"
              className="primary"
              onClick={() => void signIn()}
            >
              Sign in to generate
            </button>
          ) : null}
          {usage && !error ? <span className="ai-usage">{usage}</span> : null}
        </div>
      </form>

      {mode === "signIn" ? (
        <p className="ai-help">
          No account? Use your own key below to generate without signing in.
        </p>
      ) : null}
      {mode === "needsKey" ? (
        <p className="ai-help">Add your own key below to generate.</p>
      ) : null}

      {error ? (
        <div className="ai-error" role="alert">
          {error}
        </div>
      ) : null}

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
