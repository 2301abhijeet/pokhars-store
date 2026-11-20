import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";

export type CartQuantities = Record<string, number>;

function getCartCollection(uid: string) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase Firestore is not configured.");
  return { db, ref: collection(db, "users", uid, "cart") };
}

function normaliseCart(value: unknown): CartQuantities {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: CartQuantities = {};
  for (const [productId, quantity] of Object.entries(value)) {
    if (
      productId.length > 0 &&
      Number.isInteger(quantity) &&
      (quantity as number) >= 1
    ) {
      result[productId] = Math.min(quantity as number, 20);
    }
  }
  return result;
}

/**
 * Merge a guest cart into the signed-in customer's Firestore cart.
 * Existing cloud quantities are preserved and guest quantities are added,
 * capped at 20 per product. Product prices are never stored in the cart.
 */
export async function mergeGuestCartIntoCloud(
  uid: string,
  guestCart: CartQuantities,
): Promise<void> {
  const { db, ref } = getCartCollection(uid);
  const safeGuestCart = normaliseCart(guestCart);
  const snapshot = await getDocs(ref);

  if (Object.keys(safeGuestCart).length === 0) return;

  const remoteCart: CartQuantities = {};
  snapshot.forEach((item) => {
    const data = item.data();
    if (Number.isInteger(data.quantity) && data.quantity >= 1) {
      remoteCart[item.id] = Math.min(data.quantity, 20);
    }
  });

  const batch = writeBatch(db);
  for (const [productId, guestQuantity] of Object.entries(safeGuestCart)) {
    const quantity = Math.min(20, (remoteCart[productId] ?? 0) + guestQuantity);
    batch.set(
      doc(db, "users", uid, "cart", productId),
      { productId, quantity, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  await batch.commit();
}

/** Realtime customer cart subscription for cross-device updates. */
export function subscribeToCloudCart(
  uid: string,
  onCart: (cart: CartQuantities) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const { ref } = getCartCollection(uid);

  return onSnapshot(
    ref,
    (snapshot) => {
      const cart: CartQuantities = {};
      snapshot.forEach((item) => {
        const data = item.data();
        if (Number.isInteger(data.quantity) && data.quantity >= 1) {
          cart[item.id] = Math.min(data.quantity, 20);
        }
      });
      onCart(cart);
    },
    (cause) => onError(cause),
  );
}

/** Save or remove one product quantity in the signed-in customer's cart. */
export async function saveCloudCartItem(
  uid: string,
  productId: string,
  quantity: number,
): Promise<void> {
  const { db } = getCartCollection(uid);
  const itemRef = doc(db, "users", uid, "cart", productId);

  if (quantity <= 0) {
    await deleteDoc(itemRef);
    return;
  }

  if (!Number.isInteger(quantity) || quantity > 20) {
    throw new Error("Cart quantity must be between 1 and 20.");
  }

  await setDoc(
    itemRef,
    { productId, quantity, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
