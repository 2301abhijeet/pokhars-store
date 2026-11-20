import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  getDocs,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";

export type CustomerAddress = {
  id: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

export type AddressInput = Omit<CustomerAddress, "id">;

function addressCollection(uid: string) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase Firestore is not configured.");
  return { db, ref: collection(db, "users", uid, "addresses") };
}

function cleanInput(input: AddressInput) {
  return {
    recipientName: input.recipientName.trim(),
    phone: input.phone.trim(),
    line1: input.line1.trim(),
    ...(input.line2?.trim() ? { line2: input.line2.trim() } : {}),
    ...(input.landmark?.trim() ? { landmark: input.landmark.trim() } : {}),
    city: input.city.trim(),
    state: input.state.trim(),
    pincode: input.pincode.trim(),
  };
}

export function subscribeToCustomerAddresses(
  uid: string,
  onAddresses: (addresses: CustomerAddress[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const { ref } = addressCollection(uid);
  return onSnapshot(
    ref,
    (snapshot) => {
      const addresses = snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          recipientName: String(data.recipientName ?? ""),
          phone: String(data.phone ?? ""),
          line1: String(data.line1 ?? ""),
          line2: data.line2 ? String(data.line2) : undefined,
          landmark: data.landmark ? String(data.landmark) : undefined,
          city: String(data.city ?? ""),
          state: String(data.state ?? ""),
          pincode: String(data.pincode ?? ""),
          isDefault: data.isDefault === true,
        };
      });

      // Newer records first; missing timestamps are safely placed at the end.
      addresses.sort((a, b) => {
        const aTime = snapshot.docs.find((item) => item.id === a.id)?.data().createdAt?.toMillis?.() ?? 0;
        const bTime = snapshot.docs.find((item) => item.id === b.id)?.data().createdAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      });
      onAddresses(addresses);
    },
    (cause) => onError(cause),
  );
}

/**
 * Saves an address for the signed-in user. The first address becomes default.
 * Selecting a default address clears the default flag on the other addresses
 * in the same atomic Firestore batch.
 */
export async function saveCustomerAddress(
  uid: string,
  addressId: string | null,
  input: AddressInput,
): Promise<void> {
  const { db, ref } = addressCollection(uid);
  const snapshot = await getDocs(ref);
  const currentDefault = snapshot.docs.find((item) => item.data().isDefault === true);
  const isDefault =
    input.isDefault || !currentDefault || currentDefault.id === addressId;

  const batch = writeBatch(db);
  if (isDefault) {
    snapshot.docs.forEach((item) => {
      if (item.id !== addressId && item.data().isDefault === true) {
        batch.update(item.ref, {
          isDefault: false,
          updatedAt: serverTimestamp(),
        });
      }
    });
  }

  const payload = {
    ...cleanInput(input),
    isDefault,
    updatedAt: serverTimestamp(),
  };

  if (addressId) {
    batch.set(doc(db, "users", uid, "addresses", addressId), payload, { merge: true });
  } else {
    const newAddress = doc(ref);
    batch.set(newAddress, { ...payload, createdAt: serverTimestamp() });
  }

  await batch.commit();
}

export async function makeCustomerAddressDefault(
  uid: string,
  addressId: string,
): Promise<void> {
  const { db, ref } = addressCollection(uid);
  const snapshot = await getDocs(ref);
  const target = snapshot.docs.find((item) => item.id === addressId);
  if (!target) throw new Error("This address could not be found.");

  const batch = writeBatch(db);
  snapshot.docs.forEach((item) => {
    const nextDefault = item.id === addressId;
    if (item.data().isDefault !== nextDefault) {
      batch.update(item.ref, {
        isDefault: nextDefault,
        updatedAt: serverTimestamp(),
      });
    }
  });
  await batch.commit();
}

export async function deleteCustomerAddress(
  uid: string,
  addressId: string,
): Promise<void> {
  const { db, ref } = addressCollection(uid);
  const snapshot = await getDocs(ref);
  const target = snapshot.docs.find((item) => item.id === addressId);
  if (!target) return;

  const wasDefault = target.data().isDefault === true;
  const remaining = snapshot.docs.filter((item) => item.id !== addressId);
  const batch = writeBatch(db);
  batch.delete(target.ref);

  if (wasDefault && remaining.length > 0) {
    batch.update(remaining[0].ref, {
      isDefault: true,
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}
