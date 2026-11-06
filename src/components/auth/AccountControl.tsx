import { useEffect, useRef, useState } from "react";

import { isAuthConfigured, signIn, signOut } from "@/lib/auth/session";
import { useAuthSession } from "@/lib/auth/useAuthSession";

// The shared Omni account hub, where a user manages their profile, billing, and
// Synapse keys. Null when unset, so the "Manage account" item is simply omitted
const ACCOUNT_URL = import.meta.env.VITE_ACCOUNT_URL;

/**
 * Standard Omni account control for the Studio header, the single entry point
 * for identity (the AI panel no longer signs in on its own). Signed out shows a
 * plain "Sign in" button that starts the Gatekeeper PKCE flow; signed in shows an
 * account menu (Manage account, Sign out). Renders nothing when sign-in is not
 * configured (local/dev), where modeling stays fully anonymous.
 *
 * Signing in here is what lets managed AI generation run as the user: a signed-in
 * request reaches Synapse under the user's own identity, so Synapse applies their
 * configured keys, plan, and budget. No key is ever pasted or held by Facet.
 */
const AccountControl = () => {
  const { signedIn } = useAuthSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the menu on an outside click, like a native menu
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  // No sign-in configured (local/dev): nothing to show, modeling stays anonymous
  if (!isAuthConfigured()) return null;

  if (!signedIn) {
    return (
      <button
        type="button"
        className="account-signin"
        onClick={() => void signIn()}
        title="Sign in to generate parts with AI"
      >
        Sign in
      </button>
    );
  }

  return (
    <div className="account-menu" ref={containerRef}>
      <button
        type="button"
        className="account-trigger"
        onClick={() => setMenuOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Account menu"
        title="Account"
      >
        <span className="account-avatar" aria-hidden>
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="currentColor"
            role="img"
            aria-label="Account"
          >
            <title>Account</title>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5v.5H4V20z" />
          </svg>
        </span>
      </button>
      {menuOpen ? (
        <div className="account-dropdown" role="menu">
          {ACCOUNT_URL ? (
            <a
              className="account-item"
              href={`${ACCOUNT_URL.replace(/\/+$/, "")}/`}
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
            >
              Manage account
            </a>
          ) : null}
          <button
            type="button"
            className="account-item"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              void signOut();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default AccountControl;
