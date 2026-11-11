/**
 * Client for the `facet-api` import proxy (`POST /import`). Fetching SVG or image
 * art by URL has to go through the gateway because the browser can't read
 * cross-origin art itself. Auth plumbing (the managed bearer token) is the shared
 * `createGatewayClient`; this module only shapes the request and result.
 */

import { createGatewayClient } from "@omnidotdev/providers/ai-client";

/** What the proxy returns: SVG text, or base64 raster bytes to vectorize client-side. */
export type ImportArtResult =
  | { kind: "svg"; svg: string }
  | { kind: "image"; contentType: string; dataBase64: string };

const defaultGetAccessToken = async (): Promise<string | null> => {
  const { getAccessToken } = await import("@/lib/auth/session");
  return getAccessToken();
};

/** Fetch SVG or image art by URL through the guarded gateway proxy. */
export async function importArtFromUrl(url: string): Promise<ImportArtResult> {
  const client = createGatewayClient({
    baseUrl: import.meta.env.VITE_FACET_API_URL,
    getAccessToken: defaultGetAccessToken,
  });
  return client.post<ImportArtResult>("import", { url });
}
