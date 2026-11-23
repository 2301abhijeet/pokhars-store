import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentData,
} from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";

export type RazorpayMode = "test";

export function checkoutConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? "";
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  const allowProductionTestCheckout = process.env.VERCEL_ENV !== "production" ||
    process.env.RAZORPAY_ALLOW_PRODUCTION_TEST_CHECKOUT === "true";
  const shippingPaise = Number(process.env.CHECKOUT_TEST_SHIPPING_PAISE ?? "0");
  const validShippingPaise = Number.isSafeInteger(shippingPaise) && shippingPaise >= 0;
  const enabled = process.env.NEXT_PUBLIC_CATALOGUE_DEMO_MODE !== "true" &&
    allowProductionTestCheckout &&
    process.env.RAZORPAY_MODE === "test" &&
    keyId.startsWith("rzp_test_") &&
    Boolean(keySecret) &&
    validShippingPaise;
  return {
    enabled,
    keyId: enabled ? keyId : "",
    keySecret: enabled ? keySecret : "",
    webhookSecret,
    shippingPaise: validShippingPaise ? shippingPaise : 0,
    mode: enabled ? "test" as const : null,
  };
}

export async function razorpayRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = checkoutConfig();
  if (!config.enabled) throw new Error("Razorpay test mode is not configured.");
  const authorization = Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${authorization}`,
      "content-type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as T & { error?: { description?: string } };
  if (!response.ok) throw new Error(data?.error?.description || `Razorpay request failed (${response.status}).`);
  return data;
}

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  const secret = checkoutConfig().keySecret;
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = checkoutConfig().webhookSecret;
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function releaseReservation(
  orderRef: DocumentReference<DocumentData>,
  outcome: { status: "cancelled" | "expired" | "failed"; reason: string },
) {
  const db = adminDb();
  await db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) return;
    const order = orderSnapshot.data()!;
    if (order.paymentStatus === "paid") return;

    const items = Array.isArray(order.items) ? order.items as Array<{ productId: string; quantity: number }> : [];
    if (order.stockReserved === true) {
      const products = await Promise.all(items.map((item) => transaction.get(db.collection("products").doc(item.productId))));
      products.forEach((productSnapshot, index) => {
        if (!productSnapshot.exists) return;
        const item = items[index];
        const currentStock = Number(productSnapshot.data()?.stockQuantity) || 0;
        transaction.update(productSnapshot.ref, {
          stockQuantity: currentStock + item.quantity,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    }
    transaction.update(orderRef, {
      status: outcome.status,
      paymentStatus: "failed",
      stockReserved: false,
      failureReason: outcome.reason,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function markOrderPaid(orderRef: DocumentReference<DocumentData>, paymentId: string) {
  await adminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(orderRef);
    if (!snapshot.exists) return;
    const order = snapshot.data()!;
    if (order.paymentStatus === "paid" || order.paymentMode !== "test") return;
    transaction.update(orderRef, {
      status: "confirmed",
      statusHistory: FieldValue.arrayUnion({
        status: "confirmed",
        note: "Payment confirmed. Your order is now confirmed.",
        occurredAt: new Date().toISOString(),
      }),
      paymentStatus: "paid",
      paymentMode: "test",
      paymentId,
      stockReserved: false,
      inventoryIssue: FieldValue.delete(),
      paidAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

/** Release expired unpaid reservations after asking Razorpay whether a payment was captured. */
export async function releaseExpiredReservations() {
  if (!checkoutConfig().enabled) return;
  const db = adminDb();
  const now = Date.now();
  const snapshot = await db.collection("orders")
    .where("reservationExpiresAt", "<=", Timestamp.fromMillis(now))
    .limit(200)
    .get();
  for (const orderDoc of snapshot.docs) {
    const order = orderDoc.data();
    const expires = order.reservationExpiresAt as Timestamp | undefined;
    if (order.status !== "pending_payment" || !expires || expires.toMillis() > now) continue;
    if (!order.razorpayOrderId) {
      await releaseReservation(orderDoc.ref, { status: "expired", reason: "Checkout setup expired." });
      continue;
    }
    try {
      const paymentList = await razorpayRequest<{ items?: Array<{ id: string; status: string; amount: number; order_id: string }> }>(
        `/orders/${encodeURIComponent(order.razorpayOrderId)}/payments`,
      );
      const captured = paymentList.items?.find((payment) => payment.status === "captured" && payment.order_id === order.razorpayOrderId);
      if (captured && Number(captured.amount) === Number(order.totalPaise)) {
        await markOrderPaid(orderDoc.ref, captured.id);
        continue;
      }
      const activeOrUnclear = paymentList.items?.some((payment) => !["failed", "cancelled"].includes(payment.status));
      if (!activeOrUnclear) await releaseReservation(orderDoc.ref, { status: "expired", reason: "Payment window expired." });
    } catch {
      // Keep inventory reserved if payment state cannot be confirmed with Razorpay.
    }
  }
}
