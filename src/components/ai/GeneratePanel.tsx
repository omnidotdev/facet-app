import { AiDescribePanel } from "@omnidotdev/thornberry/ai-describe-panel";
import { useEffect, useState } from "react";

import { fetchCapabilities } from "@/ai/capabilities";
import { critiqueModel } from "@/ai/critique";
import {
  PANEL_COPY,
  PROMPT_SUGGESTIONS,
  SYNAPSE_KEY_URL,
  billingHubUrl,
  classifyGenerateError,
  formatGeneratedToast,
  formatSpentNote,
  withProvenanceHeader,
} from "@/ai/panelState";
import { generateAndRun } from "@/ai/repair";
import { isAuthConfigured, signOut } from "@/lib/auth/session";
import { useAuthSession } from "@/lib/auth/useAuthSession";
import { nameFromPrompt } from "@/tabs";

import type { RefObject } from "react";
import type { CreditBalance } from "@/ai/capabilities";
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
 * "Describe a part" generation. A toolbar button opens the shared fleet
 * describe-to-draft panel (Thornberry's `AiDescribePanel`, the same surface
 * Fractal and other products use), which turns a plain-English prompt into
 * Facet code via the gateway, loads it into the editor, runs it through the
 * Studio's own run path, and repairs on a kernel error. The panel is
 * presentational; all generation, auth, and billing logic stays here.
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
  // The signed-in user's monthly managed credit balance, so a per-generation
  // cost has context ("N left") instead of a bare number. null until known or
  // when not applicable (signed out, BYOK, or the meter was unavailable)
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  // The vision critic's suggested fix when a generated result does not match the
  // request. Null when the result looked right, capture was unavailable, or the
  // critique could not run; set keeps the panel open to show the suggestion
  const [critiqueFix, setCritiqueFix] = useState<string | null>(null);

  const { signedIn } = useAuthSession();

  const authConfigured = isAuthConfigured();

  // Probe the gateway's capability for the signed-in user; re-run on sign-in
  // state changes. Signed out means no managed access
  useEffect(() => {
    if (!authConfigured) return;
    if (!signedIn) {
      setManagedAllowed(false);
      setCredits(null);
      return;
    }
    let active = true;
    setManagedAllowed(null);
    fetchCapabilities().then((caps) => {
      if (!active) return;
      setManagedAllowed(caps.managedGeneration);
      setCredits(caps.credits ?? null);
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

  // Close and clear the transient per-attempt state so a reopen starts clean
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setError(null);
      setSpent(null);
      setOutOfCredits(false);
    }
  };

  // The success confirmation is transient: clear it after a few seconds
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const onGenerate = async () => {
    const studio = handle.current;
    const trimmed = prompt.trim();
    if (!studio || busy || !trimmed) return;
    if (!canGenerate) {
      // No-auth fallback: a key is the only path, so guide the user to it
      if (byokAllowed && !hasByok) {
        setByokOpen(true);
        setError("Add your Synapse key below to generate.");
      }
      return;
    }

    setBusy(true);
    setError(null);
    setSpent(null);
    setOutOfCredits(false);
    setCritiqueFix(null);

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
        // Stamp the prompt + date into the editor copy so the model is
        // self-documenting; the raw code (no header) is what the repair loop
        // feeds back to the gateway, so generation stays clean
        return studio.loadCode(withProvenanceHeader(code, trimmed));
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
      // Keep the shown balance fresh after a managed spend, no re-fetch needed
      if (!hasByok) {
        setCredits((c) =>
          c
            ? {
                used: c.used + result.usage.credits,
                cap: c.cap,
                remaining: Math.max(0, c.remaining - result.usage.credits),
              }
            : c,
        );
      }
      setToast(formatGeneratedToast(result.usage.credits, hasByok));

      // Ground the result: critique the render and, if it misses the request,
      // surface the model's suggested fix. Best-effort - a capture or critique
      // failure never blocks or fails the generation (it degrades to today's
      // behavior). Only runs when the viewport can be captured
      let fix: string | null = null;
      try {
        const image = studio.capture();
        if (image) {
          const verdict = await critiqueModel(
            trimmed,
            studio.getCode(),
            image,
            hasByok ? { byokKey } : {},
          );
          if (!verdict.ok && verdict.suggestedFix) fix = verdict.suggestedFix;
        }
      } catch {
        // critique is advisory; a failure never affects the generation
      }

      setBusy(false);
      if (fix) {
        // keep the panel open so the user sees the suggested refinement
        setCritiqueFix(fix);
        return;
      }
      setPrompt("");
      handleOpenChange(false);
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
        handleOpenChange(false);
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

  // Error, any billed-but-failed spend, and the upgrade funnel share the panel's
  // notice slot; the panel renders whatever node it is handed
  const notice =
    error || spent || critiqueFix || (outOfCredits && UPGRADE_URL) ? (
      <div className="ai-notice">
        {error ? <p role="alert">{error}</p> : null}
        {spent ? <p className="ai-spent">{spent}</p> : null}
        {critiqueFix ? (
          <p className="ai-critique">
            <span className="ai-critique-label">Suggested refinement:</span>{" "}
            {critiqueFix}
          </p>
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
      </div>
    ) : undefined;

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

      <AiDescribePanel
        open={open}
        onOpenChange={handleOpenChange}
        // Sign-in-first: this panel only ever renders when generation is
        // available (signed in, or local BYOK), so it always leads with Generate
        mode="generate"
        title="Describe a part"
        description={
          <>
            Generation runs through{" "}
            <a href={SYNAPSE_KEY_URL} target="_blank" rel="noopener noreferrer">
              Synapse
            </a>
            , Omni's AI router.
            {credits ? (
              <span className="ai-balance">
                {" · "}
                {credits.remaining} credit{credits.remaining === 1 ? "" : "s"}{" "}
                left this month
              </span>
            ) : null}
          </>
        }
        prompt={prompt}
        onPromptChange={setPrompt}
        placeholder="e.g. a 20mm cube with a 6mm hole through the middle"
        suggestions={PROMPT_SUGGESTIONS}
        onPickSuggestion={setPrompt}
        onGenerate={() => void onGenerate()}
        isPending={busy}
        notice={notice}
        byok={
          byokAllowed
            ? {
                open: byokOpen,
                onOpenChange: setByokOpen,
                value: byokKey,
                onValueChange: (value) => {
                  setByokKey(value);
                  persistByokKey(value);
                },
                keyUrl: SYNAPSE_KEY_URL,
                label: PANEL_COPY.byokToggle,
                placeholder: PANEL_COPY.byokPlaceholder,
              }
            : undefined
        }
      />

      {toast ? (
        <output className="ai-toast" aria-live="polite">
          {toast}
        </output>
      ) : null}
    </>
  );
};

export default GeneratePanel;
