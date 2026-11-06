/**
 * Ask the gateway what the signed-in user may do, so the Studio can show the
 * "describe a part" panel only to users who can actually use managed generation
 * (the server's env allowlist) instead of showing it to everyone and failing
 * with a 403. The allowlist never reaches the client; only the caller's own
 * yes/no does. Fails closed (no capability) on any error.
 */

export interface Capabilities {
  signedIn: boolean;
  managedGeneration: boolean;
}

const NONE: Capabilities = { signedIn: false, managedGeneration: false };

/** Lazily resolve the Omni access token, keeping the auth client out of tests. */
const defaultGetAccessToken = async (): Promise<string | null> => {
  const { getAccessToken } = await import("@/lib/auth/session");
  return getAccessToken();
};

export async function fetchCapabilities(
  getAccessToken: () => Promise<string | null> = defaultGetAccessToken,
): Promise<Capabilities> {
  const baseUrl = import.meta.env.VITE_FACET_API_URL;
  if (!baseUrl) return NONE;

  const token = await getAccessToken().catch(() => null);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/capabilities`, {
      headers,
    });
    if (!res.ok) return NONE;
    const data = (await res.json()) as Partial<Capabilities>;
    return {
      signedIn: Boolean(data.signedIn),
      managedGeneration: Boolean(data.managedGeneration),
    };
  } catch {
    return NONE;
  }
}
