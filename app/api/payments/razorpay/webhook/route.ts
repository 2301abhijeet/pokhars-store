import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, jsonError } from "@/lib/firebase/admin";
import { checkoutConfig, markOrderPaid, razorpayRequest, verifyWebhookSignature } from "@/lib/firebase/razorpay";
import { settleRefundRequest } from "@/lib/firebase/refunds";

export const runtime = "nodejs";
type WebhookPayment = { id: string; order_id: string; amount: number; currency: string; status: string };
type WebhookRefund = { id: string; payment_id: string; amount: number; status: string };

export async function POST(request: Request) {
  const config = checkoutConfig();
  if (!config.enabled || !config.webhookSecret) return jsonError("Webhook is not configured.", 503);
  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, request.headers.get("x-razorpay-signature") ?? "")) return jsonError("Invalid webhook signature.", 400);

  let event: unknown;
  try { event = JSON.parse(rawBody); } catch { return jsonError("Invalid webhook payload.", 400); }
  if (!event || typeof event !== "object" || Array.isArray(event)) return jsonError("Invalid webhook payload.", 400);
  const payload = event as {
    event?: unknown;
    payload?: { payment?: { entity?: WebhookPayment }; refund?: { entity?: WebhookRefund } };
  };
  const eventName = payload.event;
  const db = adminDb();
  const eventId = request.headers.get("x-razorpay-event-id") || createHash("sha256").update(rawBody).digest("hex");
  const eventRef = db.collection("razorpayWebhookEvents").doc(createHash("sha256").update(eventId).digest("hex"));
  const priorEvent = await eventRef.get();
  if (priorEvent.exists) return Response.json({ received: true, duplicate: true });

  if (eventName === "refund.processed" || eventName === "refund.failed") {
    const refund = payload.payload?.refund?.entity;
    if (!refund || typeof refund.id !== "string" || typeof refund.payment_id !== "string") return Response.json({ received: true, ignored: true });
    const mapping = await db.collection("refunds").doc(refund.id).get();
    if (!mapping.exists || typeof mapping.data()?.refundRequestId !== "string") {
      await eventRef.set({ event: eventName, state: "unmatched_refund", refundId: refund.id, createdAt: FieldValue.serverTimestamp() });
      return Response.json({ received: true, unmatched: true });
    }
    await settleRefundRequest(String(mapping.data()?.refundRequestId), refund.id, eventName === "refund.processed" ? "processed" : "failed");
    await eventRef.set({ event: eventName, state: "processed", refundId: refund.id, createdAt: FieldValue.serverTimestamp() });
    return Response.json({ received: true });
  }

  if (eventName !== "payment.captured" && eventName !== "payment.failed") {
    await eventRef.set({ event: String(eventName ?? "unknown"), state: "ignored", createdAt: FieldValue.serverTimestamp() });
    return Response.json({ received: true, ignored: true });
  }

  const payment = payload.payload?.payment?.entity;
  if (!payment || typeof payment.id !== "string" || typeof payment.order_id !== "string") return Response.json({ received: true, ignored: true });
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
    const verified = await razorpayRequest<WebhookPayment>("/payments/" + encodeURIComponent(payment.id));
    if (verified.status !== "captured" || verified.order_id !== order.razorpayOrderId ||
        verified.amount !== order.totalPaise || verified.currency !== "INR") return jsonError("Captured payment could not be confirmed.", 409);
    await markOrderPaid(orderDoc.ref, verified.id);
  } else {
    await orderDoc.ref.update({ lastPaymentFailure: { paymentId: payment.id, at: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp() });
  }
  await eventRef.set({ event: eventName, state: "processed", orderId: orderDoc.id, createdAt: FieldValue.serverTimestamp() });
  return Response.json({ received: true });
}
