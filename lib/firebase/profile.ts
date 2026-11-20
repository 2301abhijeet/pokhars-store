import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { getFirebaseDb } from "@/lib/firebase/client";

export async function ensureCustomerProfile(user: User): Promise<void> {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase Firestore is not configured.");

  const profileRef = doc(db, "users", user.uid);
  const existing = await getDoc(profileRef);

  const profile = {
    uid: user.uid,
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    photoURL: user.photoURL ?? "",
    updatedAt: serverTimestamp(),
    ...(!existing.exists() ? { createdAt: serverTimestamp() } : {}),
  };

  await setDoc(profileRef, profile, { merge: true });
}
