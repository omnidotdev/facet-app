import { AiDescribePanel } from "@omnidotdev/thornberry/ai-describe-panel";
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchCapabilities } from "@/ai/capabilities";
import { critiqueModel } from "@/ai/critique";
import { reportDisposition } from "@/ai/disposition";
import { GenerateError } from "@/ai/generate";
import {
  BALANCE_CAPTION,
  PANEL_COPY,
  PROMPT_SUGGESTIONS,
  SYNAPSE_KEY_URL,
  SYNAPSE_URL,
  billingHubUrl,
  canUpgrade,
  classifyGenerateError,
  createThrottle,
  creditCount,
  creditsSpent,
  followUpAction,
  followUpNotice,
  formatGeneratedToast,
  formatPerPartEstimate,
  formatSpentNote,
  noticeLinks,
  phaseLabel,
  shouldClearOutOfCredits,
  studioReturnUrl,
  upgradeUrl,
  withProvenanceHeader,
} from "@/ai/panelState";
import { generateAndRun } from "@/ai/repair";
import { isAuthConfigured, requireReauth } from "@/lib/auth/session";
import { useAuthSession } from "@/lib/auth/useAuthSession";
import { nameFromPrompt } from "@/tabs";

import type { RefObject } from "react";
import type { Capabilities, CreditBalance } from "@/ai/capabilities";
import type {
  FollowUpAction,
  GenerateErrorAction,
  GeneratePhase,
} from "@/ai/panelState";
import type { ModelRunner } from "@/ai/repair";
import type { StudioHandle } from "@/FacetStudio";

// Kept out of our servers: a BYOK Synapse key lives only in this browser. Used
// only in the no-auth (local/dev) fallback; signed-in users never paste a key
const BYOK_STORAGE_KEY = "facet:ai-byok-key:v1";

// What the user's last managed generation actually debited, remembered per
// browser so the panel can show an honest, self-calibrating "about N credits
// per part" estimate instead of a hardcoded guess. Per-device only, never sent
const LAST_SPEND_STORAGE_KEY = "facet:ai-last-spend:v1";

// The shared Omni account hub, where credits and Facet Pro are bought. Unset
// means the billing links are simply omitted
const ACCOUNT_URL = import.meta.env.VITE_ACCOUNT_URL;

// How often a return to the tab may re-read the balance and plan (after buying
// credits or upgrading in the hub's tab), so focus churn never floods the API
const REFRESH_ON_FOCUS_MS = 10_000;

/** A notice in the panel: its message and the failure it came from, if any */
interface PanelNotice {
  message: string;
  action: GenerateErrorAction | null;
}

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

/** Read the last managed spend, tolerating private mode or disabled storage. */
function loadLastSpend(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SPEND_STORAGE_KEY);
    const value = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Remember the last managed spend for the per-part estimate, best-effort. */
function persistLastSpend(credits: number): void {
  try {
    localStorage.setItem(LAST_SPEND_STORAGE_KEY, String(credits));
  } catch {
    // Private mode or storage disabled; the estimate just stays on its fallback
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
  // The panel's notice (an error or a billing refusal) and what caused it, so
  // the matching Buy credits / Upgrade links show beside it
  const [notice, setNotice] = useState<PanelNotice | null>(null);
  // Credits a failed-but-charged managed attempt took off the balance
  const [spent, setSpent] = useState<string | null>(null);
  // A short confirmation shown after the dialog closes on a successful generate
  const [toast, setToast] = useState<string | null>(null);
  const [byokOpen, setByokOpen] = useState(false);
  const [byokKey, setByokKey] = useState(loadByokKey);
  // null while unknown; the gateway says whether this user may use managed
  // generation (the server's env allowlist), so the panel is shown only to
  // permitted users rather than to everyone with a 403 after the fact
  const [managedAllowed, setManagedAllowed] = useState<boolean | null>(null);
  // The signed-in user's pooled Omni credit balance (shared across products),
  // so a per-generation cost has context. null until known or when not
  // applicable (signed out, BYOK, or the balance could not be read)
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  // The billed workspace's Facet tier (drives the Upgrade entry point) and its
  // slug (deep-links the hub to it). Undefined until known, or against an
  // older gateway that does not report the workspace
  const [tier, setTier] = useState<string | undefined>(undefined);
  const [workspaceSlug, setWorkspaceSlug] = useState<string | undefined>(
    undefined,
  );
  // Which step of a managed generation is in flight, surfaced as a live status
  // beside the spinner so a multi-call run reads as progress: "generating", then
  // "checking" (the vision model grounds the result against the render), then
  // "refining" if that check wants a better pass. The user never sees the
  // under-the-hood critique, only a plain status. null when idle
  const [phase, setPhase] = useState<GeneratePhase | null>(null);
  // What the user's last generation actually debited, for the honest per-part
  // estimate shown in the panel footer (self-calibrating, never a hardcoded guess)
  const [lastSpend, setLastSpend] = useState<number | null>(loadLastSpend);

  const { signedIn } = useAuthSession();

  const authConfigured = isAuthConfigured();

  // Adopt the billing details of a capability answer (balance, tier, and the
  // workspace they belong to)
  const adoptBilling = useCallback((caps: Capabilities) => {
    setCredits(caps.credits ?? null);
    setTier(caps.tier);
    setWorkspaceSlug(caps.workspace?.slug);
  }, []);

  // Probe the gateway's capability for the signed-in user; re-run on sign-in
  // state changes. Signed out means no managed access
  useEffect(() => {
    if (!authConfigured) return;
    if (!signedIn) {
      setManagedAllowed(false);
      setCredits(null);
      setTier(undefined);
      setWorkspaceSlug(undefined);
      return;
    }
    let active = true;
    setManagedAllowed(null);
    fetchCapabilities().then((caps) => {
      if (!active) return;
      // The token predates the workspace claim: drop it and prompt a new
      // sign-in rather than leaving a panel that can never generate
      if (caps.reauthRequired) {
        void requireReauth();
        return;
      }
      setManagedAllowed(caps.managedGeneration);
      adoptBilling(caps);
    });
    return () => {
      active = false;
    };
  }, [authConfigured, signedIn, adoptBilling]);

  // Re-read the balance and plan when the user comes back to the tab, since
  // credits are bought and plans upgraded in the account hub's tab. Throttled,
  // and only for a managed user. A purchase that lands clears the
  // out-of-credits notice; a failed read keeps what is shown (the probe above
  // owns whether the panel shows at all)
  const allowFocusRefresh = useRef(createThrottle(REFRESH_ON_FOCUS_MS));
  useEffect(() => {
    if (!authConfigured || !signedIn || !managedAllowed) return;
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (!allowFocusRefresh.current()) return;
      fetchCapabilities().then((caps) => {
        if (!active) return;
        if (caps.reauthRequired) {
          void requireReauth();
          return;
        }
        if (!caps.managedGeneration) return;
        adoptBilling(caps);
        const balance = caps.credits?.balance ?? null;
        setNotice((current) =>
          current && shouldClearOutOfCredits(current.action, balance)
            ? null
            : current,
        );
      });
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [authConfigured, signedIn, managedAllowed, adoptBilling]);
  // BYOK is the no-auth (local/dev) fallback only; signed-in prod users never
  // paste a key (their Synapse identity drives generation)
  const byokAllowed = !authConfigured;
  const hasByok = byokAllowed && byokKey.trim().length > 0;
  const canGenerate = authConfigured ? signedIn : hasByok;

  // Re-read the pooled balance after a managed attempt (the gateway debits it,
  // never local math) and return it for the spent-credits figure
  const refreshBalance = async (): Promise<number | null> => {
    const caps = await fetchCapabilities();
    if (caps.managedGeneration) adoptBilling(caps);
    else setCredits(caps.credits ?? null);
    return caps.credits?.balance ?? null;
  };

  // Close and clear the transient per-attempt state so a reopen starts clean
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setNotice(null);
      setSpent(null);
      setPhase(null);
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
        setNotice({
          message: "Add your Synapse key below to generate.",
          action: null,
        });
      }
      return;
    }

    setBusy(true);
    setNotice(null);
    setSpent(null);
    setPhase("generating");
    // The balance before this generation, so what it spent can be read off the
    // balance change afterwards
    const balanceBefore = credits?.balance ?? null;

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
      setNotice(null);
      setSpent(null);

      // The gateway's id for this generation chain, threaded through the critique
      // and any refine so the whole loop, and the kept signal below, correlate
      const generationId = result.generationId;

      // A billing refusal (out of credits, plan, usage limit) from the check or
      // refine below. The draft is kept either way; this only tells the user
      // why it was not checked or improved, with the matching billing link
      // (a holder, since the critique's catch callback sets it)
      const followUp: {
        current: { action: FollowUpAction; message: string } | null;
      } = { current: null };

      // Ground the result: critique the render and, if it misses the request,
      // automatically refine once (regenerate with the critic's guidance) so the
      // user gets a better model instead of under-the-hood instructions.
      // Best-effort: a capture, critique, or refine failure degrades to the
      // first good result and never blocks, fails, or discards it. Only runs
      // when the viewport can be captured
      try {
        setPhase("checking");
        const image = await studio.capture();
        if (image) {
          const verdict = await critiqueModel(
            trimmed,
            studio.getCode(),
            image,
            {
              ...(hasByok ? { byokKey } : {}),
              ...(generationId ? { generationId } : {}),
            },
          ).catch((err: unknown) => {
            const action = followUpAction(
              err instanceof GenerateError ? err.status : undefined,
            );
            if (action && err instanceof GenerateError) {
              followUp.current = { action, message: err.message };
            }
            return null;
          });
          if (verdict && !verdict.ok && verdict.suggestedFix) {
            setPhase("refining");
            const refined = await generateAndRun(trimmed, runner, {
              ...(hasByok ? { byokKey } : {}),
              // Keep the same chain id so the refine pass correlates to the draft
              ...(generationId ? { generationId } : {}),
              // Keep the good first model if the refine itself fails, rather
              // than leaving the user with worse or broken code
              restorePriorOnFailure: true,
              refine: {
                code: studio.getCode(),
                suggestion: verdict.suggestedFix,
              },
            });
            if (refined.status === "error") {
              const action = followUpAction(refined.httpStatus);
              if (action) {
                followUp.current = { action, message: refined.message };
              }
            }
          }
        }
      } catch {
        // grounding is advisory; a failure never affects the generation
      }

      // The human-in-the-loop label: the result was applied and left in the
      // editor, so record it as kept, correlated to the generation. Pure
      // telemetry: fire-and-forget, never blocks or fails the generation
      void reportDisposition(generationId, "kept", hasByok ? { byokKey } : {});

      // Refresh the pooled balance after the managed spend; what this
      // generation (plus any refine) cost is the balance change
      const spentCredits = hasByok
        ? null
        : creditsSpent(balanceBefore, await refreshBalance());
      // Remember a real spend so the per-part estimate self-calibrates
      if (spentCredits) {
        setLastSpend(spentCredits);
        persistLastSpend(spentCredits);
      }

      setPhase(null);
      setBusy(false);
      setPrompt("");

      // A refused check or refine keeps the dialog open on the reason (and the
      // way to fix it); the draft is already in its own tab behind the dialog
      const refusal = followUp.current;
      if (refusal) {
        setNotice({
          message: followUpNotice(refusal.action, refusal.message),
          action: refusal.action,
        });
        setSpent(spentCredits ? formatSpentNote(spentCredits) : null);
        return;
      }

      setToast(formatGeneratedToast(spentCredits, hasByok));
      handleOpenChange(false);
      return;
    }

    // A failed managed attempt may still have billed; surface what the balance
    // went down by so the spend is never silent (BYOK never touches credits)
    const failedSpend = hasByok
      ? null
      : creditsSpent(balanceBefore, await refreshBalance());
    setSpent(failedSpend ? formatSpentNote(failedSpend) : null);
    const action = classifyGenerateError(result.httpStatus);
    switch (action) {
      case "signIn":
        // The session expired, was revoked, or predates the workspace claim.
        // Clear it and prompt a new sign-in at the header account control; this
        // panel then hides until the user signs in again
        handleOpenChange(false);
        void requireReauth();
        break;
      case "outOfCredits":
        setNotice({ message: PANEL_COPY.outOfCredits, action });
        break;
      default:
        // Plan and usage-limit refusals carry the gateway's own message, plus
        // an Upgrade link where it helps
        setNotice({ message: result.message, action });
    }
    setPhase(null);
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

  // Billing links into the account hub, deep-linked to the workspace Facet
  // bills when the gateway reports it
  const buyCreditsHref = billingHubUrl(ACCOUNT_URL, workspaceSlug);
  const upgradeHref = upgradeUrl(ACCOUNT_URL, {
    workspaceSlug,
    returnUrl: studioReturnUrl(window.location.origin),
  });
  const links = noticeLinks(notice?.action ?? null, tier);
  const noticeBuy = links.buyCredits ? buyCreditsHref : null;
  const noticeUpgrade = links.upgrade ? upgradeHref : null;

  // The notice, any billed-but-failed spend, and the billing links share the
  // panel's notice slot; the panel renders whatever node it is handed. The live
  // generation status is NOT here: it rides the panel's pendingLabel so it shows
  // beside the spinner, right where the user is waiting
  const noticeNode =
    notice || spent ? (
      <div className="ai-notice">
        {notice ? <p role="alert">{notice.message}</p> : null}
        {spent ? <p className="ai-spent">{spent}</p> : null}
        {noticeBuy || noticeUpgrade ? (
          <div className="ai-notice-actions">
            {noticeBuy ? (
              <a
                className="ai-upgrade"
                href={noticeBuy}
                target="_blank"
                rel="noopener noreferrer"
              >
                {PANEL_COPY.buyCredits}
              </a>
            ) : null}
            {noticeUpgrade ? (
              <a
                className={
                  noticeBuy ? "ai-upgrade ai-upgrade-secondary" : "ai-upgrade"
                }
                href={noticeUpgrade}
                target="_blank"
                rel="noopener noreferrer"
              >
                {PANEL_COPY.upgrade}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : undefined;

  // A quiet Upgrade to Pro link for the free tier, beside the balance. Hidden
  // for paid tiers, and while the notice already offers it
  const metaUpgrade =
    !hasByok && canUpgrade(tier) && !noticeUpgrade ? upgradeHref : null;

  // The strategic footer slot: what the user weighs right before spending. The
  // pooled balance (prominent), its shared-across-Omni context (a quiet
  // caption), an honest per-part estimate drawn from the last real spend, and
  // the free tier's way up. Managed only; BYOK bills the caller's own account,
  // so credits do not apply
  const meta =
    !hasByok && (credits || metaUpgrade) ? (
      <span className="ai-meta">
        {credits ? (
          <span className="ai-meta-primary">
            <span className="ai-credits">{creditCount(credits.balance)}</span>
            <span className="ai-meta-caption">{BALANCE_CAPTION}</span>
          </span>
        ) : null}
        <span className="ai-meta-secondary">
          {credits ? (
            <span className="ai-estimate">
              {formatPerPartEstimate(lastSpend)}
            </span>
          ) : null}
          {metaUpgrade ? (
            <a
              className="ai-upgrade-link"
              href={metaUpgrade}
              target="_blank"
              rel="noopener noreferrer"
            >
              {PANEL_COPY.upgrade}
            </a>
          ) : null}
        </span>
      </span>
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
            <a
              className="ai-router-link"
              href={SYNAPSE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Synapse
            </a>
            , Omni's AI router.
          </>
        }
        prompt={prompt}
        onPromptChange={setPrompt}
        placeholder="e.g. a 20mm cube with a 6mm hole through the middle"
        suggestions={PROMPT_SUGGESTIONS}
        onPickSuggestion={setPrompt}
        onGenerate={() => void onGenerate()}
        isPending={busy}
        pendingLabel={phase ? phaseLabel(phase) : undefined}
        meta={meta}
        notice={noticeNode}
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
