import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { completeCallback } from "@/lib/auth/session";

/** @knipignore */
export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

/**
 * OAuth redirect target. Completes the PKCE code exchange, then sends the user
 * back to wherever they started sign-in. Managed generation is the only thing
 * gated on auth, so a failure here is non-fatal: offer a link home where BYOK
 * and local modeling still work.
 */
function AuthCallback() {
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await completeCallback(window.location.search);
      if (cancelled) return;
      if (result.ok) {
        // Full navigation so the app re-reads the now-present session
        window.location.replace(result.returnTo);
      } else {
        setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="facet-landing">
      <section className="fl-gate">
        {error ? (
          <>
            <p>Sign-in could not be completed.</p>
            <a href="/">Back to Facet</a>
          </>
        ) : (
          <p>Signing you in…</p>
        )}
      </section>
    </div>
  );
}
