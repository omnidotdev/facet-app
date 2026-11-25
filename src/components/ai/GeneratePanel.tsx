import { AiDescribePanel } from "@omnidotdev/thornberry/ai-describe-panel";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { fetchCapabilities } from "@/ai/capabilities";
import { critiqueModel } from "@/ai/critique";
import { reportDisposition } from "@/ai/disposition";
import { GenerateError } from "@/ai/generate";
import {
  QUEUE_COPY,
  discardConfirm,
  finishedJobs,
  finishedToast,
  hasActiveJobs,
  pollDelay,
  queueIndicator,
  withoutDismissed,
} from "@/ai/jobQueue";
import {
  dismissGeneration,
  enqueueGeneration,
  listGenerations,
} from "@/ai/jobs";
import {
  BALANCE_CAPTION,
  PANEL_COPY,
  PROMPT_SUGGESTIONS,
  PROMPT_SUGGESTION_COUNT,
  SYNAPSE_KEY_URL,
  SYNAPSE_URL,
  addCardLabel,
  billingHubUrl,
  canUpgrade,
  classifyGenerateError,
  createThrottle,
  creditsSpent,
  followUpAction,
  followUpNotice,
  formatBalance,
  formatGeneratedToast,
  formatPerPartEstimate,
  formatSpentNote,
  noticeLinks,
  phaseLabel,
  refreshedAccess,
  resolveManagedAccess,
  resolvePanelMode,
  shouldClearOutOfCredits,
  shouldClearPaymentRequired,
  stripProvenanceHeader,
  studioReturnUrl,
  upgradeUrl,
  withProvenanceHeader,
} from "@/ai/panelState";
import { generateAndRun } from "@/ai/repair";
import GenerationQueue from "@/components/ai/GenerationQueue";
import PartChat from "@/components/ai/PartChat";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { isAuthConfigured, requireReauth } from "@/lib/auth/session";
import { useAuthSession } from "@/lib/auth/useAuthSession";
import useHubLoginHint from "@/lib/auth/useHubLoginHint";
import { nameFromPrompt } from "@/tabs";

import type { RefObject } from "react";
import type { Capabilities, CreditBalance } from "@/ai/capabilities";
import type { GenerateResult } from "@/ai/generate";
import type { GenerationJob } from "@/ai/jobs";
import type {
  FollowUpAction,
  GenerateErrorAction,
  GeneratePhase,
  ManagedAccess,
} from "@/ai/panelState";
import type { ModelRunner } from "@/ai/repair";
import type { JobFailureLinks } from "@/components/ai/GenerationQueue";
import type { ChatMessage } from "@/components/ai/PartChat";
import type { StudioHandle } from "@/FacetStudio";
import type { ParamValue } from "@/params";

// Kept out of our servers: a BYOK Synapse key lives only in this browser. Used
// in the no-auth (local/dev) fallback and by a signed-in user who is not a
// paying customer yet; a paying customer generates on their own identity
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

/** A toast outside the dialog, optionally offering to open the panel */
interface PanelToast {
  message: string;
  /** A background part finished: offer a way back to the queue */
  showOpen?: boolean;
}

// Shown when a request failed with nothing user-safe to say about it
const GENERIC_FAILURE = "AI generation failed. Please try again.";

/** What the chat says back about a requested change */
const CHAT_COPY = {
  done: "Changed the part.",
  undone: "Undone. The part is back as it was.",
  switchedTabs: "You switched tabs, so the change was not made.",
  undoOtherTab: "Switch back to that part's tab to undo the change.",
  needsAccess: "Making changes uses AI credits. See your options to continue.",
} as const;

interface GeneratePanelProps {
  /** The Studio's editor + run handle, populated after its setup effect runs. */
  handle: RefObject<StudioHandle | null>;
  /**
   * Where the chat for changing the open part docks (under the 3D view), or
   * null while it is not mounted yet
   */
  chatMount?: HTMLElement | null;
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
 * A managed generation runs as a background job on the gateway: Generate
 * queues it and frees the panel at once, a compact queue in the panel (and a
 * count on the trigger) shows each part as Queued, Generating, Ready, or
 * Failed, and a ready part waits, across closing the panel, switching tabs, or
 * leaving the page, until it is opened (landing in a new tab exactly as a
 * finished generate does) or discarded. BYOK stays in the foreground, since a
 * user's own key is never stored.
 *
 * Sign-in-first: identity lives in the header account control, not here. When
 * sign-in is configured (prod), this panel shows only to signed-in users, and a
 * managed request reaches Synapse under the user's own identity (their keys,
 * plan, and budget) with no key ever pasted. Managed generation is for paying
 * customers (Facet Pro, or a workspace that bought AI credits): a signed-in
 * user who is not one yet sees the panel in a paid-access state that offers
 * Buy credits, Upgrade to Pro, and their own Synapse key. When sign-in is NOT configured
 * (local/dev), the panel offers a BYOK Synapse key as the only path, so local
 * modeling and offline testing still work. Local modeling stays anonymous either
 * way.
 *
 * Renders nothing when no gateway is configured, so the static app still works,
 * and nothing here reads the auth session or touches the network in that case.
 */
const GeneratePanel = ({ handle, chatMount }: GeneratePanelProps) => {
  // No gateway, no button, and no auth session read
  if (!import.meta.env.VITE_FACET_API_URL) return null;
  return <GeneratePanelInner handle={handle} chatMount={chatMount} />;
};

const GeneratePanelInner = ({ handle, chatMount }: GeneratePanelProps) => {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  // The panel's notice (an error or a billing refusal) and what caused it, so
  // the matching Buy credits / Upgrade links show beside it
  const [notice, setNotice] = useState<PanelNotice | null>(null);
  // Credits a failed-but-charged managed attempt took off the balance
  const [spent, setSpent] = useState<string | null>(null);
  // A short message shown outside the dialog: a confirmation after a
  // successful generate, or news that a background part finished (with a way
  // to open the panel to it)
  const [toast, setToast] = useState<PanelToast | null>(null);
  const [byokOpen, setByokOpen] = useState(false);
  const [byokKey, setByokKey] = useState(loadByokKey);
  // null while unknown; the gateway says whether this user may use managed
  // generation, must pay first (the paid-access state), or has no AI access,
  // so the panel shows the right state rather than failing after the fact
  const [access, setAccess] = useState<ManagedAccess | null>(null);
  // The signed-in user's pooled AI credit balance (shared across products),
  // so a per-generation cost has context. null until known or when not
  // applicable (signed out, BYOK, or the balance could not be read)
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  // The billed workspace's Facet tier (drives the Upgrade entry point) and its
  // slug (deep-links the hub to it). Undefined until known, or against an
  // older gateway that does not report the workspace
  const [tier, setTier] = useState<string | undefined>(undefined);
  // Card-verified free AI credits, offered only while the gateway reports it
  const [cardOffer, setCardOffer] = useState<{ monthlyCredits: number } | null>(
    null,
  );
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

  // Background generation: a managed Generate queues a job on the gateway and
  // frees the panel at once; the job keeps running (and its result waits) when
  // the panel closes or the page is left. The list is the gateway's, read on
  // load and polled while anything is active, so a return shows every result
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  // Mirror for async callbacks (poll reads compare against the last list)
  const jobsRef = useRef<GenerationJob[]>([]);
  // The ready part being opened (its follow-up checks run in the panel)
  const [openingId, setOpeningId] = useState<string | null>(null);
  // (Re)start polling right away, e.g. after an enqueue; set by the poll effect
  const restartPollRef = useRef<(() => void) | null>(null);
  // Parts the user dismissed, so an in-flight list read cannot bring one back
  const dismissedRef = useRef(new Set<string>());
  // A job queued while nothing else was active, with the balance at that
  // moment: its spend is the balance change when it finishes (overlapping
  // jobs make the change unattributable, so no figure is shown for them)
  const soloRef = useRef<{ jobId: string; balance: number } | null>(null);
  // What a ready part's draft cost, when known, for the toast on opening it
  const jobSpendRef = useRef(new Map<string, number>());
  // What a failed part took off the balance, when known, shown on its row
  const [spentNotes, setSpentNotes] = useState<Record<string, string>>({});
  // The ready or queued part awaiting a discard confirmation
  const [confirming, setConfirming] = useState<GenerationJob | null>(null);
  // Whether the dialog shows, for async callbacks (toast only when it does not)
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const { signedIn } = useAuthSession();
  // Hub links open the hub as the account Facet is signed in as
  const loginHint = useHubLoginHint();

  const authConfigured = isAuthConfigured();

  // Adopt the billing details of a capability answer (balance, tier, and the
  // workspace they belong to)
  const adoptBilling = useCallback((caps: Capabilities) => {
    setCardOffer(caps.cardOffer ?? null);
    setCredits(caps.credits ?? null);
    setTier(caps.tier);
    setWorkspaceSlug(caps.workspace?.slug);
  }, []);

  // Probe the gateway's capability for the signed-in user; re-run on sign-in
  // state changes. Signed out means no managed access
  useEffect(() => {
    if (!authConfigured) return;
    if (!signedIn) {
      setAccess("none");
      setCredits(null);
      setTier(undefined);
      setWorkspaceSlug(undefined);
      return;
    }
    let active = true;
    setAccess(null);
    fetchCapabilities().then((caps) => {
      if (!active) return;
      // The token predates the workspace claim: drop it and prompt a new
      // sign-in rather than leaving a panel that can never generate
      if (caps.reauthRequired) {
        void requireReauth();
        return;
      }
      setAccess(resolveManagedAccess(caps));
      adoptBilling(caps);
    });
    return () => {
      active = false;
    };
  }, [authConfigured, signedIn, adoptBilling]);

  // Re-read the balance and plan when the user comes back to the tab, since
  // credits are bought and plans upgraded in the account hub's tab. Throttled,
  // and only while the panel shows (managed, or the paid-access state). A
  // purchase that lands switches the panel to generating and clears a billing
  // notice; a failed read keeps what is shown (the probe above owns whether
  // the panel shows at all)
  const allowFocusRefresh = useRef(createThrottle(REFRESH_ON_FOCUS_MS));
  const panelAvailable = access === "managed" || access === "paymentRequired";
  useEffect(() => {
    if (!authConfigured || !signedIn || !panelAvailable) return;
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
        const next = resolveManagedAccess(caps);
        if (next === "none") return;
        setAccess(next);
        adoptBilling(caps);
        const balance = caps.credits?.balance ?? null;
        setNotice((current) =>
          current &&
          (shouldClearOutOfCredits(current.action, balance) ||
            shouldClearPaymentRequired(current.action, next))
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
  }, [authConfigured, signedIn, panelAvailable, adoptBilling]);

  // The paid-access state: signed in, but not a paying customer yet
  const paidAccess = authConfigured && access === "paymentRequired";
  // BYOK is the no-auth (local/dev) fallback, and the way a signed-in user who
  // has not paid can still generate. A paying customer never pastes a key
  // (their Synapse identity drives generation)
  const byokAllowed = !authConfigured || paidAccess;
  const hasByok = byokAllowed && byokKey.trim().length > 0;
  const canGenerate = authConfigured
    ? hasByok || (signedIn && access === "managed")
    : hasByok;
  // Background jobs are the managed path's; the list stays readable in the
  // paid-access state too, so a part that finished never vanishes
  const queueEnabled = authConfigured && signedIn && panelAvailable;

  // Re-read the pooled balance after a managed attempt (the gateway debits it,
  // never local math) and return it for the spent-credits figure. Also settles
  // a stale access state (e.g. a 402 that says the user must pay first)
  const refreshBalance = useCallback(async (): Promise<number | null> => {
    const caps = await fetchCapabilities();
    if (caps.managedGeneration) adoptBilling(caps);
    else setCredits(caps.credits ?? null);
    setAccess((current) =>
      current ? refreshedAccess(current, caps) : current,
    );
    return caps.credits?.balance ?? null;
  }, [adoptBilling]);

  // Close and clear the transient per-attempt state so a reopen starts clean
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setNotice(null);
      setSpent(null);
      setPhase(null);
    }
  };

  // The toast is transient: clear it after a few seconds (longer when it
  // offers to open the panel)
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(
      () => setToast(null),
      toast.showOpen ? 8000 : 4000,
    );
    return () => window.clearTimeout(id);
  }, [toast]);

  // Show a new job list: note what finished since the last read, re-read the
  // balance it moved, attribute a solo job's spend, and tell a user who is
  // elsewhere in the app
  const applyJobs = useCallback(
    async (incoming: GenerationJob[]) => {
      const next = withoutDismissed(incoming, dismissedRef.current);
      const finished = finishedJobs(jobsRef.current, next);
      jobsRef.current = next;
      setJobs(next);
      if (finished.length === 0) return;

      const balance = await refreshBalance();
      const solo = soloRef.current;
      const soloJob = solo && finished.find((job) => job.id === solo.jobId);
      if (solo && soloJob) {
        soloRef.current = null;
        const soloSpent = creditsSpent(solo.balance, balance);
        if (soloSpent && soloJob.status === "succeeded") {
          jobSpendRef.current.set(soloJob.id, soloSpent);
        } else if (soloSpent) {
          setSpentNotes((current) => ({
            ...current,
            [soloJob.id]: formatSpentNote(soloSpent),
          }));
        }
      }

      if (!openRef.current) {
        const message = finishedToast(finished);
        if (message) setToast({ message, showOpen: true });
      }
    },
    [refreshBalance],
  );

  // Read the job list on load (so leaving and returning shows every result),
  // and poll while any job is queued or generating, backing off as a
  // generation takes its minute or two. Polling pauses while the page is
  // hidden and resumes on return; it stops when nothing is active
  useEffect(() => {
    if (!queueEnabled) {
      jobsRef.current = [];
      setJobs([]);
      return;
    }
    let active = true;
    let reading = false;
    // a restart asked for while a read was in flight (its answer may predate
    // a just-queued part), so read again once it lands
    let readAgain = false;
    let round = 0;
    let timer: number | undefined;
    const read = async () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      if (reading) {
        readAgain = true;
        return;
      }
      reading = true;
      try {
        const next = await listGenerations();
        if (!active) return;
        if (next) await applyJobs(next);
        if (!active || readAgain) return;
        if (hasActiveJobs(next ?? jobsRef.current)) {
          timer = window.setTimeout(read, pollDelay(round));
          round += 1;
        }
      } finally {
        reading = false;
        if (active && readAgain) {
          readAgain = false;
          void read();
        }
      }
    };
    const restart = () => {
      round = 0;
      void read();
    };
    const onReturn = () => {
      if (document.visibilityState === "visible") restart();
    };
    restartPollRef.current = restart;
    void read();
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      active = false;
      restartPollRef.current = null;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [queueEnabled, applyJobs]);

  // React to a refused generation (a failed run, or a refused enqueue) the way
  // the panel always has: sign in again, switch to the paid-access state, or
  // show the reason with the matching billing link
  const showFailure = (
    httpStatus: number | undefined,
    errorCode: string | undefined,
    message: string,
  ) => {
    const action = classifyGenerateError(httpStatus, errorCode);
    switch (action) {
      case "signIn":
        // The session expired, was revoked, or predates the workspace claim.
        // Clear it and prompt a new sign-in at the header account control; this
        // panel then hides until the user signs in again
        handleOpenChange(false);
        void requireReauth();
        break;
      case "paymentRequired":
        // Not a paying customer (e.g. a capability answer that went stale):
        // switch to the paid-access state, which carries its own explanation
        // and the ways forward, rather than calling it out of credits
        setAccess("paymentRequired");
        setNotice(null);
        break;
      case "outOfCredits":
        setNotice({ message: PANEL_COPY.outOfCredits, action });
        break;
      default:
        // Plan and usage-limit refusals carry the gateway's own message, plus
        // an Upgrade link where it helps
        setNotice({ message, action });
    }
  };

  /**
   * Generate in the foreground and land the result in a fresh tab: the draft
   * (or a finished background job's code, `initial`), any kernel-error
   * repairs, the render check and refine, then the kept signal and a toast.
   * BYOK always runs here (its key is never stored for a background job), as
   * does a managed generation against an older gateway without jobs
   */
  const runGeneration = async (
    studio: StudioHandle,
    trimmed: string,
    opts: {
      /** A finished background job's result, opened instead of a new draft */
      initial?: GenerateResult;
      /** What that job's draft cost, when known (null when unknown) */
      priorSpend?: number | null;
    } = {},
  ) => {
    setBusy(true);
    setNotice(null);
    setSpent(null);
    setPhase(opts.initial ? "checking" : "generating");
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
      ...(opts.initial ? { initial: opts.initial } : {}),
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
            stripProvenanceHeader(studio.getCode()),
            image,
            {
              ...(hasByok ? { byokKey } : {}),
              ...(generationId ? { generationId } : {}),
            },
          ).catch((err: unknown) => {
            const action =
              err instanceof GenerateError
                ? followUpAction(err.status, err.code)
                : null;
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
                code: stripProvenanceHeader(studio.getCode()),
                suggestion: verdict.suggestedFix,
              },
            });
            if (refined.status === "error") {
              const action = followUpAction(
                refined.httpStatus,
                refined.errorCode,
              );
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
      // generation (plus any refine) cost is the balance change, plus what an
      // opened background draft already cost when that is known
      const runSpent = hasByok
        ? null
        : creditsSpent(balanceBefore, await refreshBalance());
      const spentCredits = opts.initial
        ? opts.priorSpend
          ? opts.priorSpend + (runSpent ?? 0)
          : null
        : runSpent;
      // Remember a real spend so the per-part estimate self-calibrates
      if (spentCredits) {
        setLastSpend(spentCredits);
        persistLastSpend(spentCredits);
      }

      setPhase(null);
      setBusy(false);
      // An opened part keeps whatever the user is typing for the next one
      if (!opts.initial) setPrompt("");

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

      setToast({ message: formatGeneratedToast(spentCredits, hasByok) });
      handleOpenChange(false);
      return;
    }

    // A failed managed attempt may still have billed; surface what the balance
    // went down by so the spend is never silent (BYOK never touches credits)
    const failedSpend = hasByok
      ? null
      : creditsSpent(balanceBefore, await refreshBalance());
    setSpent(failedSpend ? formatSpentNote(failedSpend) : null);
    showFailure(result.httpStatus, result.errorCode, result.message);
    setPhase(null);
    setBusy(false);
  };

  /**
   * Queue a managed generation. Resolves "queued" (the panel is free again),
   * "refused" (the reason is shown, exactly as a refused generate), or
   * "unsupported" (an older gateway without jobs; generate in the foreground)
   */
  const enqueue = async (
    text: string,
  ): Promise<"queued" | "refused" | "unsupported"> => {
    setBusy(true);
    setNotice(null);
    setSpent(null);
    try {
      const job = await enqueueGeneration(text);
      // Its spend can be read off the balance only if nothing else is running
      const balance = credits?.balance;
      soloRef.current =
        !hasActiveJobs(jobsRef.current) && typeof balance === "number"
          ? { jobId: job.id, balance }
          : null;
      const next = [job, ...jobsRef.current.filter((j) => j.id !== job.id)];
      jobsRef.current = next;
      setJobs(next);
      restartPollRef.current?.();
      return "queued";
    } catch (err) {
      if (err instanceof GenerateError && err.status === 404) {
        return "unsupported";
      }
      if (err instanceof GenerateError) {
        showFailure(err.status, err.code, err.message);
      } else {
        showFailure(undefined, undefined, GENERIC_FAILURE);
      }
      return "refused";
    } finally {
      setBusy(false);
    }
  };

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

    // Managed generation runs in the background; BYOK stays in the foreground
    if (!hasByok) {
      const queued = await enqueue(trimmed);
      if (queued === "queued") {
        setPrompt("");
        return;
      }
      if (queued === "refused") return;
    }
    await runGeneration(studio, trimmed);
  };

  // The chat that changes the open part in place: its conversation, whether a
  // change is being made, and what each change replaced (for its Undo)
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const chatIdRef = useRef(0);
  const undoRef = useRef(
    new Map<
      string,
      { tabId: string; code: string; params: Record<string, ParamValue> }
    >(),
  );
  const nextChatId = () => {
    chatIdRef.current += 1;
    return `chat-${chatIdRef.current}`;
  };
  const updateReply = (id: string, patch: Partial<ChatMessage>) =>
    setChat((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  /**
   * Change the open part as the user asked: send the model in the editor and
   * the request, load the updated model into the same tab (repairing a kernel
   * error like a generation does), and keep the part as it was if that fails.
   * Runs in the foreground, BYOK or managed, since the result lands in the
   * editor the user is looking at. Spend is read off the balance change
   */
  const onChatSend = async (text: string) => {
    const studio = handle.current;
    if (!studio || chatBusy || busy) return;
    const askId = nextChatId();
    const replyId = nextChatId();
    setChat((list) => [
      ...list,
      { id: askId, role: "user", text },
      { id: replyId, role: "assistant", text: "", status: "pending" },
    ]);

    if (!canGenerate) {
      // The panel explains the ways forward (paid access, or the user's own
      // key in local/dev)
      updateReply(replyId, { status: "failed", text: CHAT_COPY.needsAccess });
      setOpen(true);
      return;
    }

    setChatBusy(true);
    const tabId = studio.getTabId();
    const before = studio.getCode();
    // The model goes out without its provenance header, which goes back on
    // whatever comes back, so the part still records where it came from
    const model = stripProvenanceHeader(before);
    const header = before.slice(0, before.length - model.length);
    // The sliders as they are now: sent along so the updated model's defaults
    // carry them forward, and put back if the change fails or is undone
    const params = studio.getParams();
    const balanceBefore = credits?.balance ?? null;
    const runner: ModelRunner = {
      getCode: () => studio.getCode(),
      loadCode: (code) => {
        // Never write into a tab the user switched to while this ran
        if (studio.getTabId() !== tabId) {
          return Promise.reject(new Error("The tab changed"));
        }
        // Restoring the part as it was puts its sliders back too; an updated
        // model starts its sliders at its new defaults
        return code === before
          ? studio.loadCode(before, params)
          : studio.loadCode(header + stripProvenanceHeader(code), {});
      },
    };

    const result = await generateAndRun(text, runner, {
      ...(hasByok ? { byokKey } : {}),
      edit: { code: model, params },
      restorePriorOnFailure: true,
    });

    const switched = studio.getTabId() !== tabId;
    const spentCredits = hasByok
      ? null
      : creditsSpent(balanceBefore, await refreshBalance());
    const note = spentCredits ? formatSpentNote(spentCredits) : undefined;

    if (result.status === "ok") {
      undoRef.current.set(replyId, { tabId, code: before, params });
      updateReply(replyId, { status: "done", text: CHAT_COPY.done, note });
    } else {
      updateReply(replyId, {
        status: "failed",
        text: switched ? CHAT_COPY.switchedTabs : result.message,
        note,
      });
      // A billing or sign-in refusal: the panel shows why, and the way forward
      const action = classifyGenerateError(result.httpStatus, result.errorCode);
      if (!switched && action !== "generic") {
        showFailure(result.httpStatus, result.errorCode, result.message);
        if (action !== "signIn") setOpen(true);
      }
    }
    setChatBusy(false);
  };

  // Put the part back as it was before a change, in the tab it was made in
  const onChatUndo = (id: string) => {
    const studio = handle.current;
    const saved = undoRef.current.get(id);
    if (!studio || !saved || chatBusy) return;
    if (studio.getTabId() !== saved.tabId) {
      setChat((list) => [
        ...list,
        {
          id: nextChatId(),
          role: "assistant",
          text: CHAT_COPY.undoOtherTab,
          status: "failed",
        },
      ]);
      return;
    }
    undoRef.current.delete(id);
    void studio.loadCode(saved.code, saved.params);
    updateReply(id, { status: "undone", text: CHAT_COPY.undone });
  };

  const onChatClear = () => {
    undoRef.current.clear();
    setChat([]);
  };

  // Forget a part locally and on the gateway (which deletes its prompt and
  // result). A ready part left unopened is reported as discarded
  const dismissJob = (job: GenerationJob) => {
    dismissedRef.current.add(job.id);
    jobSpendRef.current.delete(job.id);
    if (soloRef.current?.jobId === job.id) soloRef.current = null;
    const next = jobsRef.current.filter((j) => j.id !== job.id);
    jobsRef.current = next;
    setJobs(next);
    setSpentNotes(({ [job.id]: _dropped, ...rest }) => rest);
    void dismissGeneration(job.id);
  };

  // Open a ready part: what a successful generate does (a new tab, run, then
  // the repair, check, and refine steps), after which it leaves the queue
  const openJob = async (job: GenerationJob) => {
    const studio = handle.current;
    if (!studio || busy || !job.code) return;
    setOpeningId(job.id);
    await runGeneration(studio, job.prompt, {
      initial: {
        code: job.code,
        ...(job.generationId ? { generationId: job.generationId } : {}),
      },
      priorSpend: jobSpendRef.current.get(job.id) ?? null,
    });
    // The part now lives in its own tab, so the queued copy is not needed
    dismissedRef.current.add(job.id);
    jobSpendRef.current.delete(job.id);
    const next = jobsRef.current.filter((j) => j.id !== job.id);
    jobsRef.current = next;
    setJobs(next);
    void dismissGeneration(job.id);
    setOpeningId(null);
  };

  const discardConfirmed = () => {
    const job = confirming;
    setConfirming(null);
    if (!job) return;
    if (job.status === "succeeded") {
      void reportDisposition(job.generationId, "discarded");
    }
    dismissJob(job);
  };

  // Retry a failed part with the same prompt; the failure clears once the
  // new one is queued
  const retryJob = async (job: GenerationJob) => {
    if (busy) return;
    if ((await enqueue(job.prompt)) === "queued") dismissJob(job);
  };

  // Sign-in-first: when sign-in is configured (prod), the panel appears only for
  // a signed-in user the gateway says may use managed generation or must pay
  // for it first (the paid-access state). Signed-out, no-access, and
  // not-yet-known states hide it. With no auth configured (local/dev), BYOK is
  // the path, so the panel stays available. The gate is still enforced
  // server-side regardless of what the UI shows
  if (authConfigured && !(signedIn && panelAvailable)) return null;

  // Billing links into the account hub, deep-linked to the workspace Facet
  // bills when the gateway reports it
  const buyCreditsHref = billingHubUrl(ACCOUNT_URL, workspaceSlug, loginHint);
  const upgradeHref = upgradeUrl(ACCOUNT_URL, {
    workspaceSlug,
    returnUrl: studioReturnUrl(window.location.origin),
    loginHint,
  });
  // The paid-access state always offers the ways to pay; otherwise the links
  // follow whatever failure the notice reports
  const links = noticeLinks(
    paidAccess ? "paymentRequired" : (notice?.action ?? null),
    tier,
  );
  const noticeBuy = links.buyCredits ? buyCreditsHref : null;
  const noticeUpgrade = links.upgrade ? upgradeHref : null;

  // A failed part's billing links follow its reason, like the notice's
  const jobFailureLinks = (job: GenerationJob): JobFailureLinks => {
    const jobLinks = noticeLinks(
      classifyGenerateError(job.error?.status, job.error?.code),
      tier,
    );
    return {
      buyCredits: jobLinks.buyCredits ? buyCreditsHref : null,
      upgrade: jobLinks.upgrade ? upgradeHref : null,
    };
  };

  const queueNode =
    jobs.length > 0 ? (
      <GenerationQueue
        jobs={jobs}
        disabled={busy}
        openingId={openingId}
        spentNotes={spentNotes}
        failureLinks={jobFailureLinks}
        onOpen={(job) => void openJob(job)}
        onDiscard={setConfirming}
        onRetry={(job) => void retryJob(job)}
        onDismiss={dismissJob}
      />
    ) : null;

  // The notice, any billed-but-failed spend, the billing links, and the
  // background queue share the panel's notice slot; the panel renders whatever
  // node it is handed. The live generation status is NOT here: it rides the
  // panel's pendingLabel so it shows beside the spinner, right where the user
  // is waiting
  const noticeNode =
    paidAccess || notice || spent || queueNode ? (
      <div className="ai-notice">
        {paidAccess ? <p>{PANEL_COPY.paymentRequired}</p> : null}
        {paidAccess && cardOffer && buyCreditsHref ? (
          <p>
            <a
              className="ai-upgrade"
              href={buyCreditsHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {addCardLabel(cardOffer.monthlyCredits)}
            </a>
          </p>
        ) : null}
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
        {queueNode}
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
  // so credits do not apply, and the paid-access state already offers its
  // ways to pay in the notice
  const meta =
    !hasByok && !paidAccess && (credits || metaUpgrade) ? (
      <span className="ai-meta">
        {credits ? (
          <span className="ai-meta-primary">
            <span className="ai-credits">{formatBalance(credits.balance)}</span>
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

  // What the trigger shows while parts generate or wait to be opened
  const indicator = queueIndicator(jobs);
  const confirmCopy = confirming
    ? discardConfirm(confirming, nameFromPrompt(confirming.prompt))
    : null;

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
        {indicator ? (
          <span
            className="ai-queue-indicator"
            data-state={indicator.ready > 0 ? "ready" : "active"}
            title={indicator.label}
          >
            {indicator.ready > 0 ? null : (
              <span className="ai-job-spinner" aria-hidden="true" />
            )}
            <span className="ai-sr-only">{indicator.label}</span>
            <span aria-hidden="true">
              {indicator.ready > 0
                ? `${indicator.ready} ready`
                : indicator.active}
            </span>
          </span>
        ) : null}
      </button>

      <AiDescribePanel
        open={open}
        onOpenChange={handleOpenChange}
        // Sign-in-first: this panel only renders when generation is available
        // (managed, or local BYOK), so it leads with Generate, except in the
        // paid-access state, where it leads with the ways to pay until the
        // user adds their own key
        mode={
          paidAccess
            ? resolvePanelMode({
                authConfigured,
                signedIn,
                hasByok,
                paymentRequired: true,
              })
            : "generate"
        }
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
        // Example prompts while the prompt is empty, shuffled per open; a pick
        // drafts it for editing, never generates
        suggestions={PROMPT_SUGGESTIONS}
        suggestionCount={PROMPT_SUGGESTION_COUNT}
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

      {chatMount
        ? createPortal(
            <PartChat
              messages={chat}
              busy={chatBusy || busy}
              onSend={(text) => void onChatSend(text)}
              onUndo={onChatUndo}
              onClear={onChatClear}
            />,
            chatMount,
          )
        : null}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title={confirmCopy?.title ?? ""}
        description={confirmCopy?.description}
        confirmLabel={confirmCopy?.confirmLabel}
        cancelLabel={QUEUE_COPY.keep}
        destructive
        onConfirm={discardConfirmed}
      />

      {toast ? (
        <output className="ai-toast" aria-live="polite">
          {toast.message}
          {toast.showOpen ? (
            <button
              type="button"
              className="ai-toast-action"
              onClick={() => {
                setToast(null);
                setOpen(true);
              }}
            >
              View
            </button>
          ) : null}
        </output>
      ) : null}
    </>
  );
};

export default GeneratePanel;
