/**
 * Fetch the signed-in user's profile from Gatekeeper's OIDC userinfo endpoint,
 * so the account control can show a real avatar (image or initials) like the
 * rest of the Omni fleet. The managed path already requests the `profile email`
 * scopes, and product APIs verify tokens against the same userinfo endpoint;
 * this reads it from the browser with the bearer token. Fails soft (null) so a
 * profile miss never breaks the menu.
 */

import { getAccessToken } from "@/lib/auth/session";

export interface UserInfo {
  name?: string;
  email?: string;
  picture?: string;
}

const AUTH_BASE_URL = import.meta.env.VITE_AUTH_BASE_URL;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export async function fetchUserInfo(
  getToken: () => Promise<string | null> = getAccessToken,
): Promise<UserInfo | null> {
  if (!AUTH_BASE_URL) return null;
  const token = await getToken().catch(() => null);
  if (!token) return null;

  try {
    const res = await fetch(
      `${AUTH_BASE_URL.replace(/\/+$/, "")}/oauth2/userinfo`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return {
      name: asString(data.name),
      email: asString(data.email),
      // OIDC uses `picture`; Better Auth user rows use `image`
      picture: asString(data.picture) ?? asString(data.image),
    };
  } catch {
    return null;
  }
}

/** Up-to-two-letter initials from a name, else the email's first letter. */
export function initialsFrom(info: UserInfo): string {
  const name = info.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return (first + last).toUpperCase();
  }
  const email = info.email?.trim();
  if (email) return email[0]?.toUpperCase() ?? "";
  return "";
}
