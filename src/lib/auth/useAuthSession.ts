import { useSyncExternalStore } from "react";

import { isSignedIn, subscribeAuth } from "@/lib/auth/session";

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
