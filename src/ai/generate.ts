/**
 * Client for the Facet AI gateway (`facet-api`). The browser never holds
 * Facet's managed Synapse key: it calls the gateway, which owns that key and all
 * cost controls. A caller's own Synapse key (BYOK) is passed through per-request
 * over TLS and never stored.
 *
 * The HTTP plumbing (bearer on the managed path, BYOK anonymous, generic
 * user-safe errors) is the fleet-shared `createGatewayClient` from
 * `@omnidotdev/providers/ai-client`; this module only shapes Facet's request
 * body and result type, and adds the gateway's stable error `code` to the
 * shared error so a billing refusal can tell "not yet a customer" apart from
 * "out of credits".
 */

import {
  GatewayError,
  createGatewayClient,
} from "@omnidotdev/providers/ai-client";

/**
 * A failed gateway call: the shared `GatewayError` (generic, user-safe message
 * plus HTTP status) and the gateway's stable error code when it sent one, e.g.
 * `payment_required` or `out_of_credits` on a 402. Absent from an older gateway
 */
export class GenerateError extends GatewayError {
  readonly code: string | undefined;

  constructor(message: string, status?: number, code?: string) {
    super(message, status);
    this.name = "GenerateError";
    this.code = code;
  }
}

/** Read the stable error code from a failed response, leaving its body unread */
const readErrorCode = async (
  response: Response,
): Promise<string | undefined> => {
  try {
    const data = (await response.clone().json()) as { code?: unknown };
    return typeof data.code === "string" && data.code.length > 0
      ? data.code
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * POST to a gateway route through the shared client, rethrowing every gateway
 * failure as a GenerateError that carries the stable error code. A
 * non-gateway throw passes through untouched (callers keep it generic)
 * @param path - The gateway route, e.g. "generate"
 * @param body - The JSON request body
 * @param opts - The BYOK key (anonymous) or the managed-path token getter
 */
export async function postToGateway<TResult>(
  path: string,
  body: Record<string, unknown>,
  opts: {
    byokKey?: string;
    getAccessToken: () => Promise<string | null>;
  },
): Promise<TResult> {
  let code: string | undefined;
  const client = createGatewayClient({
    baseUrl: import.meta.env.VITE_FACET_API_URL,
    getAccessToken: opts.getAccessToken,
    // The shared client keeps only the message and status, so note the code
    // on the way past. Typed as the global fetch, whose runtime-specific
    // extras (e.g. a preconnect helper) the client never calls
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(input, init);
      if (!response.ok) code = await readErrorCode(response);
      return response;
    }) as typeof fetch,
  });

  try {
    return await client.post<TResult>(path, body, { byokKey: opts.byokKey });
  } catch (err) {
    if (err instanceof GatewayError && !(err instanceof GenerateError)) {
      throw new GenerateError(err.message, err.status, code);
    }
    throw err;
  }
}

/**
 * A generation's output. No credit figure comes back: the Synapse gateway
 * debits the user's pooled balance, and the panel reads the refreshed balance
 */
export interface GenerateResult {
  code: string;
  /**
   * The id of this generation chain, minted by the gateway. Echo it on a refine
   * or repair re-entry (and on a disposition report) so the whole loop
   * correlates in telemetry. Absent only against an older gateway
   */
  generationId?: string;
}

/** The prior code and its run error, fed back to the gateway for a repair pass. */
export interface GeneratePrevious {
  code: string;
  error: string;
}

/**
 * The prior code and the render critic's suggestion, fed back for a refine pass.
 * Distinct from `previous`: the code ran cleanly but a render of it did not match
 * the request, so this carries a visual improvement, not a thrown error
 */
export interface GenerateRefine {
  code: string;
  suggestion: string;
}

/** The open model an edit request changes (the prompt says how) */
export interface GenerateEdit {
  code: string;
  /**
   * The values its parameter sliders are set to, by name, so the updated
   * model's defaults carry them forward
   */
  params?: Record<string, number | boolean | string>;
}

export interface GenerateOptions {
  /** A user-supplied Synapse key. When set, the gateway bills the caller. */
  byokKey?: string;
  /** Prior failed code plus its error, present only on a repair attempt. */
  previous?: GeneratePrevious;
  /** Prior code plus the critic's suggestion, present only on a refine pass. */
  refine?: GenerateRefine;
  /**
   * The model open in the editor, when the prompt asks for a change to it.
   * Sent on that edit's repairs too, so a fix still knows what was asked
   */
  edit?: GenerateEdit;
  /** Repair attempt counter (0 for the first generation). */
  attempt?: number;
  /**
   * The chain id to continue, echoed from a prior result so a refine or repair
   * re-entry stays one correlated generation. Omit on a first generation (the
   * gateway mints one and returns it)
   */
  generationId?: string;
  /**
   * Resolve the managed-path bearer token, or null when signed out. Injectable
   * for tests; defaults to the Omni session getter. Never called for a BYOK
   * request, which stays anonymous.
   */
  getAccessToken?: () => Promise<string | null>;
}

/** Lazily resolve the Omni access token, keeping the auth client out of tests. */
const defaultGetAccessToken = async (): Promise<string | null> => {
  const { getAccessToken } = await import("@/lib/auth/session");
  return getAccessToken();
};

/**
 * Generate Facet code from a plain-English prompt via the gateway. On a repair
 * attempt, pass `previous` (the failed code + its error) and an incremented
 * `attempt`. Throws a GenerateError on any non-success, carrying only the
 * gateway's generic message, its status, and its stable error code.
 */
export async function generateModel(
  prompt: string,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const body: Record<string, unknown> = { prompt };
  if (opts.previous) body.previous = opts.previous;
  if (opts.refine) body.refine = opts.refine;
  if (opts.edit) body.edit = opts.edit;
  if (typeof opts.attempt === "number") body.attempt = opts.attempt;
  if (opts.generationId) body.generationId = opts.generationId;

  return postToGateway<GenerateResult>("generate", body, {
    byokKey: opts.byokKey,
    getAccessToken: opts.getAccessToken ?? defaultGetAccessToken,
  });
}
