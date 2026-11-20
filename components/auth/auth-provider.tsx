"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { firebaseConfigured, getFirebaseAuth } from "@/lib/firebase/client";
import { ensureCustomerProfile } from "@/lib/firebase/profile";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  configured: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readableAuthError(cause: unknown): string {
  const error = cause as { code?: string; message?: string };
  switch (error?.code) {
    case "auth/unauthorized-domain":
      return "This website domain is not authorized in Firebase Authentication. Add pokhars-store.vercel.app under Authentication → Settings → Authorized domains.";
    case "auth/operation-not-allowed":
      return "Google sign-in is disabled. Enable Google under Authentication → Sign-in method.";
    case "auth/invalid-api-key":
      return "Firebase rejected the Web App API key. Check the Firebase settings in Vercel environment variables.";
    case "permission-denied":
    case "firestore/permission-denied":
      return "Google sign-in worked, but Firestore blocked profile access. Please check the published Firestore rules.";
    case "auth/network-request-failed":
      return "A network request failed. Check your connection and try again.";
    default:
      return error?.message || "Google sign-in could not be completed. Please try again.";
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseConfigured) {
      setLoading(false);
      return;
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      return;
    }

    let active = true;

    // Read the result of a Google redirect after the browser returns to the store.
    void getRedirectResult(auth).catch((cause: unknown) => {
      if (active) setError(readableAuthError(cause));
    });

    const unsubscribe = onAuthStateChanged(
      auth,
      async (nextUser) => {
        if (!active) return;
        setUser(nextUser);
        setLoading(false);

        if (nextUser) {
          try {
            await ensureCustomerProfile(nextUser);
          } catch (cause) {
            if (active) {
              setError(
                "Google sign-in completed, but your customer profile could not sync: " +
                  readableAuthError(cause),
              );
            }
          }
        }
      },
      (authError) => {
        if (!active) return;
        setError(readableAuthError(authError));
        setLoading(false);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    const auth = getFirebaseAuth();
    if (!auth) {
      const message = "Firebase project configuration is not connected yet.";
      setError(message);
      throw new Error(message);
    }

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      // Redirect avoids browser popup blockers and works more consistently
      // across desktop and mobile browsers.
      await signInWithRedirect(auth, provider);
    } catch (cause) {
      const message = readableAuthError(cause);
      setError(message);
      throw cause;
    }
  }, []);

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    setError(null);
    await firebaseSignOut(auth);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, configured: firebaseConfigured, error, signInWithGoogle, signOut }),
    [user, loading, error, signInWithGoogle, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
