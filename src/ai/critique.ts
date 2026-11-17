/**
 * Client for the Facet AI gateway's `/critique` route: hand a rendered image of
 * a generated part to a vision model and get a structured verdict on whether it
 * matches the request. The grounding step of the render-and-critique loop.
 *
 * Mirrors `generate.ts`: the browser never holds Facet's managed key; the HTTP
 * plumbing is the same `postToGateway` (the fleet-shared client plus the
 * gateway's stable error code), and a BYOK key is passed through per-request
 * and never stored
 */

import { postToGateway } from "./generate";

/** A render handed to the critic: raw base64 (no data: prefix) plus its type. */
export interface CritiqueImage {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  data: string;
}

/** The vision model's structured verdict. */
export interface Critique {
  ok: boolean;
  score: number;
  issues: string[];
  suggestedFix: string | null;
}

export interface CritiqueOptions {
  /** A user-supplied Synapse key. When set, the gateway bills the caller. */
  byokKey?: string;
  /** The generation chain id this critique belongs to, for telemetry correlation. */
  generationId?: string;
  /** Resolve the managed-path bearer token, or null when signed out. */
  getAccessToken?: () => Promise<string | null>;
}

const defaultGetAccessToken = async (): Promise<string | null> => {
  const { getAccessToken } = await import("@/lib/auth/session");
  return getAccessToken();
};

/**
 * Ask the gateway whether `image` (a render of the geometry produced by `code`)
 * matches `prompt`. Throws a GenerateError on any non-success, carrying only the
 * gateway's generic message.
 */
export async function critiqueModel(
  prompt: string,
  code: string,
  image: CritiqueImage,
  opts: CritiqueOptions = {},
): Promise<Critique> {
  const body: Record<string, unknown> = { prompt, code, image };
  if (opts.generationId) body.generationId = opts.generationId;

  return postToGateway<Critique>("critique", body, {
    byokKey: opts.byokKey,
    getAccessToken: opts.getAccessToken ?? defaultGetAccessToken,
  });
}
