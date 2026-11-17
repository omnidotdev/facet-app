/**
 * Client for background AI generation (`/generations` on the Facet gateway).
 *
 * A managed generation takes a minute or two, so instead of holding one long
 * request open the Studio queues it as a job: the gateway runs every check the
 * synchronous route runs (sign-in, paying customer, credits, limits) and
 * answers at once, a worker generates in the background, and the Studio polls
 * the user's job list. Leaving or reloading loses nothing; the result waits
 * until it is opened or dismissed (or 24 hours pass).
 *
 * Managed only: a BYOK key is never stored, so BYOK stays on `generateModel`
 */

import { GenerateError, postToGateway } from "./generate";

/** Where a job is: waiting, generating, ready, or failed */
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/** A failed job's reason: the gateway's stable code and user-safe message */
export interface JobError {
  code?: string;
  message: string;
  /** The HTTP status the synchronous route would have answered with */
  status?: number;
}

export interface GenerationJob {
  id: string;
  status: JobStatus;
  /** What the user asked for */
  prompt: string;
  /** The generation chain id, echoed on repair, refine, and disposition */
  generationId?: string;
  /** The generated code, once succeeded */
  code?: string;
  /** Why it failed, once failed */
  error?: JobError;
  createdAt?: string;
}

const GENERIC_FAILURE = "AI generation failed. Please try again.";
const STATUSES = new Set<JobStatus>([
  "queued",
  "running",
  "succeeded",
  "failed",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * Read a job from the gateway's JSON, or null when it is not a usable job (a
 * ready job must carry its code). Failure text is the gateway's user-safe
 * message or a generic one, never anything internal
 */
export const parseJob = (raw: unknown): GenerationJob | null => {
  if (!isRecord(raw)) return null;
  const { id, status, prompt } = raw;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof status !== "string" || !STATUSES.has(status as JobStatus)) {
    return null;
  }
  if (typeof prompt !== "string") return null;

  const job: GenerationJob = { id, status: status as JobStatus, prompt };
  const generationId = optionalString(raw.generationId);
  if (generationId) job.generationId = generationId;
  const createdAt = optionalString(raw.createdAt);
  if (createdAt) job.createdAt = createdAt;

  if (job.status === "succeeded") {
    const code = optionalString(raw.code);
    if (!code) return null;
    job.code = code;
  }
  if (job.status === "failed") {
    const error = isRecord(raw.error) ? raw.error : {};
    job.error = {
      message: optionalString(error.message) ?? GENERIC_FAILURE,
      ...(optionalString(error.code) ? { code: error.code as string } : {}),
      ...(typeof error.status === "number" ? { status: error.status } : {}),
    };
  }
  return job;
};

interface JobsOptions {
  /** Resolve the managed-path bearer token, or null when signed out */
  getAccessToken?: () => Promise<string | null>;
}

/** Lazily resolve the Omni access token, keeping the auth client out of tests */
const defaultGetAccessToken = async (): Promise<string | null> => {
  const { getAccessToken } = await import("@/lib/auth/session");
  return getAccessToken();
};

/** The gateway's `/generations` URL, or null when no gateway is configured */
const generationsUrl = (suffix = ""): string | null => {
  const base = import.meta.env.VITE_FACET_API_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/generations${suffix}`;
};

/** A bearer header for the signed-in user, or null when signed out */
const authHeaders = async (
  opts: JobsOptions,
): Promise<Record<string, string> | null> => {
  const token = await (opts.getAccessToken ?? defaultGetAccessToken)().catch(
    () => null,
  );
  return token ? { authorization: `Bearer ${token}` } : null;
};

/**
 * Queue a managed generation. Resolves with the queued job; throws a
 * GenerateError carrying the gateway's status and stable code when it refuses
 * (e.g. 402 `payment_required`, 429 `too_many_jobs`), so a refusal reads the
 * same as it does from `generateModel`
 */
export async function enqueueGeneration(
  prompt: string,
  opts: JobsOptions = {},
): Promise<GenerationJob> {
  const data = await postToGateway<{ job?: unknown }>(
    "generations",
    { prompt },
    { getAccessToken: opts.getAccessToken ?? defaultGetAccessToken },
  );
  const job = parseJob(data?.job);
  if (!job) throw new GenerateError(GENERIC_FAILURE);
  return job;
}

/**
 * The signed-in user's recent jobs, newest first. Null when the list could not
 * be read (signed out, offline, or a gateway error), so the caller keeps what
 * it shows; an older gateway without jobs reads as an empty list
 */
export async function listGenerations(
  opts: JobsOptions = {},
): Promise<GenerationJob[] | null> {
  const url = generationsUrl();
  if (!url) return null;
  const headers = await authHeaders(opts);
  if (!headers) return null;
  try {
    const res = await fetch(url, { headers });
    if (res.status === 404) return [];
    if (!res.ok) return null;
    const data = (await res.json()) as { jobs?: unknown };
    if (!Array.isArray(data.jobs)) return null;
    return data.jobs
      .map(parseJob)
      .filter((job): job is GenerationJob => job !== null);
  } catch {
    return null;
  }
}

/**
 * Dismiss a job, deleting its prompt and result on the gateway. Resolves true
 * once it is gone (a job already gone counts), false on any other failure.
 * Never throws
 */
export async function dismissGeneration(
  id: string,
  opts: JobsOptions = {},
): Promise<boolean> {
  const url = generationsUrl(`/${encodeURIComponent(id)}`);
  if (!url) return false;
  const headers = await authHeaders(opts);
  if (!headers) return false;
  try {
    const res = await fetch(url, { method: "DELETE", headers });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
