import type { GenerationJob, JobStatus } from "./jobs";

/**
 * Pure logic for the background generation queue, kept out of the component so
 * it is unit-tested without a DOM: how each state reads, when to poll, what
 * just finished, and what the "Describe a part" trigger shows while the panel
 * is closed
 */

/** How each job state reads in the queue */
const JOB_LABELS: Record<JobStatus, string> = {
  queued: "Queued",
  running: "Generating",
  succeeded: "Ready",
  failed: "Failed",
};

/** The plain-English label for a job state */
export const jobLabel = (status: JobStatus): string => JOB_LABELS[status];

/** Whether a job is still waiting or generating */
const isActive = (job: GenerationJob): boolean =>
  job.status === "queued" || job.status === "running";

/** Whether any job is still waiting or generating (polling continues) */
export const hasActiveJobs = (jobs: readonly GenerationJob[]): boolean =>
  jobs.some(isActive);

/** First poll delay, growth per round, and the ceiling, in milliseconds */
const POLL_START_MS = 2_000;
const POLL_GROWTH = 1.5;
const POLL_MAX_MS = 10_000;

/**
 * How long to wait before the next list read: quick at first (a refusal or a
 * fast job shows promptly), backing off while a generation takes its minute or
 * two, never slower than the ceiling
 * @param round - Reads since the list last changed or polling (re)started
 */
export const pollDelay = (round: number): number =>
  Math.min(POLL_MAX_MS, Math.round(POLL_START_MS * POLL_GROWTH ** round));

/**
 * The jobs that finished between two reads: active in `before`, done in
 * `after`. A job first seen already finished (a page load) is not news
 */
export const finishedJobs = (
  before: readonly GenerationJob[],
  after: readonly GenerationJob[],
): GenerationJob[] => {
  const wasActive = new Set(before.filter(isActive).map((job) => job.id));
  return after.filter((job) => wasActive.has(job.id) && !isActive(job));
};

/** What the trigger shows while the panel is closed */
export interface QueueIndicator {
  /** Jobs queued or generating */
  active: number;
  /** Jobs ready to open */
  ready: number;
  /** Accessible summary, e.g. "2 generating, 1 ready" */
  label: string;
}

/** The trigger's queue indicator, or null when nothing is pending or ready */
export const queueIndicator = (
  jobs: readonly GenerationJob[],
): QueueIndicator | null => {
  const active = jobs.filter(isActive).length;
  const ready = jobs.filter((job) => job.status === "succeeded").length;
  if (active === 0 && ready === 0) return null;
  const parts = [
    ...(active > 0 ? [`${active} generating`] : []),
    ...(ready > 0 ? [`${ready} ready`] : []),
  ];
  return { active, ready, label: parts.join(", ") };
};

/**
 * The toast for jobs that finished while the user was elsewhere in the app,
 * or null when nothing finished. Ready news wins over a failure; the queue in
 * the panel carries every detail
 */
export const finishedToast = (
  finished: readonly GenerationJob[],
): string | null => {
  const ready = finished.filter((job) => job.status === "succeeded").length;
  if (ready === 1)
    return "Your part is ready. Open Describe a part to view it.";
  if (ready > 1) {
    return `${ready} parts are ready. Open Describe a part to view them.`;
  }
  if (finished.length > 0) {
    return "A generation failed. Open Describe a part for details.";
  }
  return null;
};

/**
 * Drop jobs the user already dismissed, so a list read that was in flight
 * while they dismissed one cannot bring it back
 */
export const withoutDismissed = (
  jobs: readonly GenerationJob[],
  dismissed: ReadonlySet<string>,
): GenerationJob[] => jobs.filter((job) => !dismissed.has(job.id));

/**
 * User-facing queue copy, kept here so it is covered by tests. Plain and
 * user-safe: no internals, and the result is "your part", never a "job"
 */
export const QUEUE_COPY = {
  /** Accessible name of the queue list */
  listLabel: "Your generations",
  /** Shown while anything is generating, so leaving is clearly safe */
  backgroundHint:
    "Generating in the background. You can close this or leave the page; your part will wait here.",
  open: "Open",
  discard: "Discard",
  cancel: "Cancel",
  retry: "Try again",
  dismiss: "Dismiss",
  keep: "Keep",
} as const;

/**
 * The confirmation for discarding a job: a ready part (its result is deleted)
 * or a queued one (it will not be generated). Names the part and says it
 * cannot be undone
 * @param job - The job to discard
 * @param name - A short name for it (e.g. from the prompt)
 */
export const discardConfirm = (
  job: Pick<GenerationJob, "status">,
  name: string,
): { title: string; description: string; confirmLabel: string } =>
  job.status === "succeeded"
    ? {
        title: `Discard “${name}”?`,
        description:
          "The generated part will be deleted and cannot be recovered.",
        confirmLabel: "Discard part",
      }
    : {
        title: `Cancel “${name}”?`,
        description:
          "It will be removed from your queue and not generated. This cannot be undone.",
        confirmLabel: "Cancel generation",
      };
