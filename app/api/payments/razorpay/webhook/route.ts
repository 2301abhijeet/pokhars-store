import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, jsonError } from "@/lib/firebase/admin";
import { checkoutConfig, markOrderPaid, razorpayRequest, verifyWebhookSignature } from "@/lib/firebase/razorpay";

export const runtime = "nodejs";

type WebhookPayment = { id: string; order_id: string; amount: number; currency: string; status: string };

export async function POST(request: Request) {
  const config = checkoutConfig();
  if (!config.enabled || !config.webhookSecret) return jsonError("Webhook is not configured.", 503);

  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  if (!verifyWebhookSignature(rawBody, signature)) return jsonError("Invalid webhook signature.", 400);

  let event: unknown;
  try { event = JSON.parse(rawBody); } catch { return jsonError("Invalid webhook payload.", 400); }
  if (!event || typeof event !== "object" || Array.isArray(event)) return jsonError("Invalid webhook payload.", 400);
  const payload = event as { event?: unknown; payload?: { payment?: { entity?: WebhookPayment } } };
  const eventName = payload.event;
  const payment = payload.payload?.payment?.entity;
  if ((eventName !== "payment.captured" && eventName !== "payment.failed") || !payment ||
      typeof payment.id !== "string" || typeof payment.order_id !== "string") {
    return Response.json({ received: true, ignored: true });
  }

  const db = adminDb();
  const eventId = request.headers.get("x-razorpay-event-id") || createHash("sha256").update(rawBody).digest("hex");
  const eventRef = db.collection("razorpayWebhookEvents").doc(createHash("sha256").update(eventId).digest("hex"));
  const priorEvent = await eventRef.get();
  if (priorEvent.exists) return Response.json({ received: true, duplicate: true });

  const matching = await db.collection("orders").where("razorpayOrderId", "==", payment.order_id).limit(1).get();
  const orderDoc = matching.docs[0];
  if (!orderDoc) {
    await eventRef.set({ event: eventName, state: "unmatched", createdAt: FieldValue.serverTimestamp() });
    return Response.json({ received: true });
  }
  const order = orderDoc.data();
  if (order.paymentMode !== "test" || payment.amount !== order.totalPaise || payment.currency !== "INR") {
    await eventRef.set({ event: eventName, state: "mismatch", orderId: orderDoc.id, createdAt: FieldValue.serverTimestamp() });
    return jsonError("Webhook payment does not match the order.", 409);
  }

  if (eventName === "payment.captured") {
    // Ask Razorpay directly before marking the order paid; the webhook is a
    // signal to check payment state, and the server API is the source of truth.
    const verified = await razorpayRequest<WebhookPayment>(`/payments/${encodeURIComponent(payment.id)}`);
    if (verified.status !== "captured" || verified.order_id !== order.razorpayOrderId || verified.amount !== order.totalPaise || verified.currency !== "INR") {
      return jsonError("Captured payment could not be confirmed.", 409);
    }
    await markOrderPaid(orderDoc.ref, verified.id);
  } else {
    await orderDoc.ref.update({
      lastPaymentFailure: { paymentId: payment.id, at: FieldValue.serverTimestamp() },
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await eventRef.set({ event: eventName, state: "processed", orderId: orderDoc.id, createdAt: FieldValue.serverTimestamp() });
  return Response.json({ received: true });
}
