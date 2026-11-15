import { useEffect, useRef, useState } from "react";

import { fetchCapabilities } from "@/ai/capabilities";
import { setAiTrainingConsent } from "@/ai/consent";
import { isAuthConfigured, signIn, signOut } from "@/lib/auth/session";
import { useAuthSession } from "@/lib/auth/useAuthSession";
import { fetchUserInfo, initialsFrom } from "@/lib/auth/userInfo";

import type { UserInfo } from "@/lib/auth/userInfo";

// The shared Omni account hub, where a user manages their profile, billing, and
// Synapse keys. Null when unset, so the "Manage account" item is simply omitted
const ACCOUNT_URL = import.meta.env.VITE_ACCOUNT_URL;

// Omni's privacy policy, where the AI training-data terms the toggle opts into
// are described in full
const PRIVACY_URL = "https://omni.dev/legal/privacy";

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
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  // Whether this user can use managed generation (so the AI data-sharing toggle
  // is relevant) and their current opt-in, loaded from the gateway on sign-in
  const [managedGeneration, setManagedGeneration] = useState(false);
  const [consent, setConsent] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load the profile (name/email/avatar) from userinfo once signed in, so the
  // trigger can show a real avatar instead of a generic glyph
  useEffect(() => {
    if (!signedIn) {
      setUserInfo(null);
      setManagedGeneration(false);
      setConsent(false);
      return;
    }
    let active = true;
    fetchUserInfo().then((info) => {
      if (active) setUserInfo(info);
    });
    // The data-sharing toggle is shown only to users who can use managed
    // generation; its initial state is the gateway's record of their opt-in
    fetchCapabilities().then((caps) => {
      if (!active) return;
      setManagedGeneration(caps.managedGeneration);
      setConsent(Boolean(caps.aiTrainingConsent));
    });
    return () => {
      active = false;
    };
  }, [signedIn]);

  const initials = userInfo ? initialsFrom(userInfo) : "";

  // Persist a consent change optimistically, reverting if the gateway rejects
  // it. Turning it off also erases the user's stored samples server-side
  const onToggleConsent = async () => {
    if (savingConsent) return;
    const next = !consent;
    setConsent(next);
    setSavingConsent(true);
    try {
      setConsent(await setAiTrainingConsent(next));
    } catch {
      setConsent(!next);
    } finally {
      setSavingConsent(false);
    }
  };

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
          {userInfo?.picture ? (
            <img className="account-avatar-img" src={userInfo.picture} alt="" />
          ) : initials ? (
            <span className="account-avatar-initials">{initials}</span>
          ) : (
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
          )}
        </span>
      </button>
      {menuOpen ? (
        <div className="account-dropdown" role="menu">
          {userInfo?.name || userInfo?.email ? (
            <div className="account-identity">
              {userInfo.name ? (
                <span className="account-name">{userInfo.name}</span>
              ) : null}
              {userInfo.email ? (
                <span className="account-email">{userInfo.email}</span>
              ) : null}
            </div>
          ) : null}
          {managedGeneration ? (
            <div className="account-consent">
              <button
                type="button"
                role="switch"
                aria-checked={consent}
                className="account-consent-toggle"
                onClick={() => void onToggleConsent()}
                disabled={savingConsent}
              >
                <span className="account-consent-label">
                  Help improve Facet's AI
                </span>
                <span className="account-consent-switch" aria-hidden>
                  <span className="account-consent-knob" />
                </span>
              </button>
              <p className="account-consent-desc">
                Share your prompts and generated models so generation keeps
                getting better. Off by default; turn it off anytime to stop and
                delete what you shared.{" "}
                <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                  Privacy policy
                </a>
              </p>
            </div>
          ) : null}
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
