import { useSyncExternalStore } from "react";

import {
  isSignedIn,
  reauthMessage,
  subscribeAuth,
  subscribeReauth,
} from "@/lib/auth/session";

/**
 * Reactive signed-in state for the managed AI path. Re-renders on sign-in/out
 * in this tab (via the session store) and across tabs (via the storage event
 * the session module listens for). Server snapshot is false: the SPA has no SSR
 * and nothing is signed in before hydration.
 */
export const useAuthSession = (): { signedIn: boolean } => {
  const signedIn = useSyncExternalStore(subscribeAuth, isSignedIn, () => false);
  return { signedIn };
};

/**
 * The pending "sign in again" message (a session was dropped because it can no
 * longer use managed generation), or null. Server snapshot is null
 */
export const useReauthMessage = (): string | null =>
  useSyncExternalStore(subscribeReauth, reauthMessage, () => null);
