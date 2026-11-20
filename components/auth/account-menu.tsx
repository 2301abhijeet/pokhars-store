"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";

export function AccountMenu() {
  const { user, loading, configured, error, signInWithGoogle, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  async function handleGoogleSignIn() {
    setWorking(true);
    try {
      await signInWithGoogle();
    } catch {
      // Auth provider displays a helpful error in this panel.
      setWorking(false);
    }
  }

  async function handleSignOut() {
    setWorking(true);
    try {
      await signOut();
      setOpen(false);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="account-control">
      <button
        className="account-trigger"
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-trigger-dot" />
        {user ? "MY ACCOUNT" : "SIGN IN"}
      </button>

      {open && (
        <section className="account-popover" role="dialog" aria-label="Customer account">
          <h2 className="account-popover-title">
            {user ? `Hello, ${user.displayName?.split(" ")[0] || "there"}!` : "Your POKHAR'S account"}
          </h2>

          {!configured ? (
            <p className="account-popover-copy">
              Firebase is not connected yet. Sign-in will activate once the Firebase project
              and Web App configuration are added.
            </p>
          ) : loading ? (
            <p className="account-popover-copy">Checking your account…</p>
          ) : user ? (
            <>
              <p className="account-email">{user.email ?? "Signed in with Google"}</p>
              <p className="account-popover-copy">
                Your customer profile is connected. Saved addresses and order history will be added next.
              </p>
              <button className="account-action" type="button" disabled={working} onClick={handleSignOut}>
                {working ? "PLEASE WAIT…" : "SIGN OUT"}
              </button>
            </>
          ) : (
            <>
              <p className="account-popover-copy">
                Continue to Google securely. After sign-in, you will return to POKHAR&apos;S automatically.
              </p>
              <button className="account-action" type="button" disabled={working} onClick={handleGoogleSignIn}>
                {working ? "REDIRECTING TO GOOGLE…" : "CONTINUE WITH GOOGLE"}
              </button>
            </>
          )}

          {error && <p className="account-error" role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
