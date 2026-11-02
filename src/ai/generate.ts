/**
 * Client for the Facet AI gateway (`facet-api`). The browser never holds
 * Facet's managed Synapse key: it calls the gateway, which owns that key and all
 * cost controls. A caller's own Synapse key (BYOK) is passed through per-request
 * over TLS and never stored.
 *
 * Every failure surfaces a generic, user-safe message. The gateway returns its
 * own generic `error` string; this client forwards that verbatim and never
 * invents or leaks transport/internal detail.
 */

/** Metered cost for a managed generation. BYOK calls report zero. */
export interface GenerateUsage {
  credits: number;
  costCents: number;
}

export interface GenerateResult {
  code: string;
  usage: GenerateUsage;
}

/** The prior code and its run error, fed back to the gateway for a repair pass. */
export interface GeneratePrevious {
  code: string;
  error: string;
}

export interface GenerateOptions {
  /** A user-supplied Synapse key. When set, the gateway bills the caller. */
  byokKey?: string;
  /** Prior failed code plus its error, present only on a repair attempt. */
  previous?: GeneratePrevious;
  /** Repair attempt counter (0 for the first generation). */
  attempt?: number;
  /**
   * Resolve the managed-path bearer token, or null when signed out. Injectable
   * for tests; defaults to the Omni session getter. Never called for a BYOK
   * request, which stays anonymous.
   */
  getAccessToken?: () => Promise<string | null>;
}

/** A typed error carrying the gateway's generic message and HTTP status. */
export class GenerateError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GenerateError";
    this.status = status;
  }
}

// Shown only when the gateway is unreachable or returns no message. Never
// expose a transport error, provider detail, or stack to the user
const NOT_CONFIGURED = "AI generation is not configured.";
const GENERIC_FAILURE = "AI generation failed. Please try again.";
// A managed call with no identity. Carries status 401 so the panel surfaces it
// as a sign-in prompt, the same as the gateway's own 401, without ever calling
// the gateway blindly
const SIGN_IN_REQUIRED = "Sign in to generate, or add your own Synapse key.";

/** Lazily resolve the Omni access token, keeping the auth client out of tests. */
const defaultGetAccessToken = async (): Promise<string | null> => {
  const { getAccessToken } = await import("@/lib/auth/session");
  return getAccessToken();
};

/** Read the gateway's generic `error` string, or a safe fallback. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data.error === "string" && data.error.length > 0) {
      return data.error;
    }
  } catch {
    // A non-JSON or empty body carries no user-safe message, so fall through
  }
  return GENERIC_FAILURE;
}

/**
 * Generate Facet code from a plain-English prompt via the gateway. On a repair
 * attempt, pass `previous` (the failed code + its error) and an incremented
 * `attempt`. Throws a GenerateError on any non-success, carrying only the
 * gateway's generic message.
 */
export async function generateModel(
  prompt: string,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const baseUrl = import.meta.env.VITE_FACET_API_URL;
  if (!baseUrl) {
    throw new GenerateError(NOT_CONFIGURED);
  }

  const body: Record<string, unknown> = { prompt };
  if (opts.byokKey) body.byokKey = opts.byokKey;
  if (opts.previous) body.previous = opts.previous;
  if (typeof opts.attempt === "number") body.attempt = opts.attempt;

  const endpoint = `${baseUrl.replace(/\/$/, "")}/generate`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  // The managed path (no BYOK key) spends our key, so it must carry an Omni
  // identity. A BYOK call stays anonymous and sends no token. With no token
  // available, do not call the gateway blindly: signal sign-in required
  if (!opts.byokKey) {
    const getToken = opts.getAccessToken ?? defaultGetAccessToken;
    const token = await getToken();
    if (!token) {
      throw new GenerateError(SIGN_IN_REQUIRED, 401);
    }
    headers.authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    // A transport failure detail is internal, so never surface it
    throw new GenerateError(GENERIC_FAILURE);
  }

  if (!response.ok) {
    throw new GenerateError(await readErrorMessage(response), response.status);
  }

  return (await response.json()) as GenerateResult;
}
