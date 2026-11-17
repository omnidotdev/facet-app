import { QUEUE_COPY, hasActiveJobs, jobLabel } from "@/ai/jobQueue";
import { PANEL_COPY } from "@/ai/panelState";

import type { GenerationJob } from "@/ai/jobs";

/** The billing links a failed part may offer (buy credits, upgrade) */
export interface JobFailureLinks {
  buyCredits: string | null;
  upgrade: string | null;
}

interface GenerationQueueProps {
  jobs: readonly GenerationJob[];
  /** Disables every action (a part is being opened) */
  disabled: boolean;
  /** The part being opened, shown as such */
  openingId: string | null;
  /** Credits a failed part took off the balance, by id, when known */
  spentNotes: Readonly<Record<string, string>>;
  /** Billing links for a failed part's reason */
  failureLinks: (job: GenerationJob) => JobFailureLinks;
  onOpen: (job: GenerationJob) => void;
  /** Discard a ready part or cancel a queued one (the host confirms first) */
  onDiscard: (job: GenerationJob) => void;
  onRetry: (job: GenerationJob) => void;
  /** Clear a failed part from the list */
  onDismiss: (job: GenerationJob) => void;
}

/**
 * The background generation queue in the "Describe a part" panel: one row per
 * recent generation with its state (Queued, Generating, Ready, Failed) and the
 * next step (open a ready part, retry or dismiss a failure, cancel a queued
 * one). Presentational; the panel owns polling, opening, and dismissal
 */
const GenerationQueue = ({
  jobs,
  disabled,
  openingId,
  spentNotes,
  failureLinks,
  onOpen,
  onDiscard,
  onRetry,
  onDismiss,
}: GenerationQueueProps) => {
  if (jobs.length === 0) return null;

  return (
    <div className="ai-queue">
      {hasActiveJobs(jobs) ? (
        <p className="ai-queue-hint">{QUEUE_COPY.backgroundHint}</p>
      ) : null}
      <ul className="ai-queue-list" aria-label={QUEUE_COPY.listLabel}>
        {jobs.map((job) => {
          const links = job.status === "failed" ? failureLinks(job) : null;
          const opening = openingId === job.id;
          return (
            <li key={job.id} className="ai-job" data-status={job.status}>
              <div className="ai-job-main">
                <span className="ai-job-prompt" title={job.prompt}>
                  {job.prompt}
                </span>
                <span className="ai-job-state" data-status={job.status}>
                  {job.status === "queued" || job.status === "running" ? (
                    <span className="ai-job-spinner" aria-hidden="true" />
                  ) : null}
                  {jobLabel(job.status)}
                </span>
              </div>

              {job.status === "failed" && job.error ? (
                <p className="ai-job-error" role="alert">
                  {job.error.message}
                </p>
              ) : null}
              {spentNotes[job.id] ? (
                <p className="ai-spent">{spentNotes[job.id]}</p>
              ) : null}

              <div className="ai-job-actions">
                {job.status === "succeeded" ? (
                  <>
                    <button
                      type="button"
                      className="ai-job-btn primary"
                      disabled={disabled}
                      aria-busy={opening}
                      onClick={() => onOpen(job)}
                    >
                      {QUEUE_COPY.open}
                    </button>
                    <button
                      type="button"
                      className="ai-job-btn"
                      disabled={disabled}
                      onClick={() => onDiscard(job)}
                    >
                      {QUEUE_COPY.discard}
                    </button>
                  </>
                ) : null}
                {job.status === "queued" ? (
                  <button
                    type="button"
                    className="ai-job-btn"
                    disabled={disabled}
                    onClick={() => onDiscard(job)}
                  >
                    {QUEUE_COPY.cancel}
                  </button>
                ) : null}
                {job.status === "failed" ? (
                  <>
                    <button
                      type="button"
                      className="ai-job-btn primary"
                      disabled={disabled}
                      onClick={() => onRetry(job)}
                    >
                      {QUEUE_COPY.retry}
                    </button>
                    <button
                      type="button"
                      className="ai-job-btn"
                      disabled={disabled}
                      onClick={() => onDismiss(job)}
                    >
                      {QUEUE_COPY.dismiss}
                    </button>
                    {links?.buyCredits ? (
                      <a
                        className="ai-upgrade-link"
                        href={links.buyCredits}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {PANEL_COPY.buyCredits}
                      </a>
                    ) : null}
                    {links?.upgrade ? (
                      <a
                        className="ai-upgrade-link"
                        href={links.upgrade}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {PANEL_COPY.upgrade}
                      </a>
                    ) : null}
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default GenerationQueue;
