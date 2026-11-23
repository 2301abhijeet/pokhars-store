import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminOrResponse, isResponse, jsonError } from "@/lib/firebase/admin";
import { razorpayRequest, type RazorpayMode } from "@/lib/firebase/razorpay";
import { settleRefundRequest } from "@/lib/firebase/refunds";

export const runtime = "nodejs";
type Context = { params: Promise<{ orderId: string }> };
type RazorpayPayment = { id: string; amount: number; currency: string; status: string };
type RazorpayRefund = { id: string; amount: number; payment_id: string; status: string };
type RefundList = { items?: RazorpayRefund[] };

export async function POST(request: Request, context: Context) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;

  const { orderId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) return jsonError("Invalid order reference.", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid refund request.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError("Invalid refund request.", 400);
  const payload = body as { amountPaise?: unknown; reason?: unknown; idempotencyKey?: unknown };
  if (payload.idempotencyKey !== undefined &&
      (typeof payload.idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{10,64}$/.test(payload.idempotencyKey))) {
    return jsonError("A valid refund idempotency key is required.", 400);
  }
  if (payload.amountPaise !== undefined &&
      (typeof payload.amountPaise !== "number" || !Number.isSafeInteger(payload.amountPaise) || payload.amountPaise < 100)) {
    return jsonError("Refunds must be at least ₹1.00.", 400);
  }
  const reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 240) : "Admin initiated refund";
  const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : randomUUID();
  const db = adminDb();
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnapshot = await orderRef.get();
  if (!orderSnapshot.exists) return jsonError("Order not found.", 404);
  const order = orderSnapshot.data()!;
  if (!["paid", "partially_refunded"].includes(String(order.paymentStatus))) return jsonError("Only captured, not-fully-refunded payments can be refunded.", 409);
  if (typeof order.paymentId !== "string" || !/^pay_[A-Za-z0-9]+$/.test(order.paymentId)) return jsonError("This order has no verified Razorpay payment ID.", 409);
  if (order.paymentMode !== "test" && order.paymentMode !== "live") return jsonError("This order's payment mode cannot be refunded through Razorpay.", 409);
  const mode: RazorpayMode = order.paymentMode === "live" ? "live" : "test";

  let payment: RazorpayPayment;
  let gatewayRefunds: RazorpayRefund[];
  try {
    payment = await razorpayRequest<RazorpayPayment>("/payments/" + encodeURIComponent(order.paymentId), {}, mode);
    const response = await razorpayRequest<RefundList>("/payments/" + encodeURIComponent(order.paymentId) + "/refunds", {}, mode);
    gatewayRefunds = Array.isArray(response.items) ? response.items : [];
  } catch (cause) {
    return jsonError(cause instanceof Error ? cause.message : "Razorpay could not verify this payment.", 503);
  }
  if (payment.status !== "captured" || payment.id !== order.paymentId || payment.currency !== "INR" || payment.amount !== Number(order.totalPaise)) {
    return jsonError("Razorpay payment details do not match this captured order.", 409);
  }

  const gatewayRefundedPaise = gatewayRefunds.filter((item) => item.status === "processed").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const requestRef = db.collection("refundRequests").doc(idempotencyKey);
  let amountPaise = Number(payload.amountPaise ?? 0);
  let completed: { refundId: string; amountPaise: number; status: string } | null = null;
  let reservationError: string | null = null;

  await db.runTransaction(async (transaction) => {
    const [latestOrder, existingRequest] = await Promise.all([transaction.get(orderRef), transaction.get(requestRef)]);
    if (!latestOrder.exists) throw new Error("ORDER_NOT_FOUND");
    const latest = latestOrder.data()!;
    if (existingRequest.exists) {
      const prior = existingRequest.data()!;
      if (prior.orderId !== orderId) throw new Error("REFUND_KEY_CONFLICT");
      if (prior.state === "processed") {
        completed = { refundId: String(prior.refundId), amountPaise: Number(prior.amountPaise), status: String(prior.refundStatus) };
        return;
      }
      if (prior.state === "failed") throw new Error("REFUND_PREVIOUSLY_FAILED");
      if (!["pending", "submitted"].includes(String(prior.state))) throw new Error("REFUND_REQUEST_STATE");
      if (payload.amountPaise !== undefined && Number(payload.amountPaise) !== Number(prior.amountPaise)) throw new Error("REFUND_KEY_CONFLICT");
      amountPaise = Number(prior.amountPaise);
      return;
    }

    const alreadyRefunded = Math.max(Number(latest.refundedPaise ?? 0), gatewayRefundedPaise);
    const inFlight = Math.max(0, Number(latest.refundsInFlightPaise ?? 0));
    const remaining = Number(latest.totalPaise) - alreadyRefunded - inFlight;
    if (!amountPaise) amountPaise = remaining;
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > remaining) throw new Error("REFUND_AMOUNT_INVALID");
    transaction.create(requestRef, {
      orderId, orderNumber: latest.orderNumber ?? orderId, paymentId: order.paymentId,
      amountPaise, reason, idempotencyKey, state: "pending",
      createdBy: access.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(orderRef, { refundsInFlightPaise: FieldValue.increment(amountPaise), updatedAt: FieldValue.serverTimestamp() });
  }).catch((cause) => { reservationError = cause instanceof Error ? cause.message : "REFUND_RESERVATION_FAILED"; });

  if (completed) return Response.json({ ok: true, refundId: completed.refundId, amountPaise: completed.amountPaise, status: completed.status, duplicate: true });
  if (reservationError === "ORDER_NOT_FOUND") return jsonError("Order not found.", 404);
  if (reservationError === "REFUND_KEY_CONFLICT") return jsonError("This idempotency key is already associated with a different order or amount.", 409);
  if (reservationError === "REFUND_AMOUNT_INVALID") return jsonError("The requested amount exceeds the remaining refundable balance.", 409);
  if (reservationError === "REFUND_PREVIOUSLY_FAILED") return jsonError("This refund request failed. Start a new refund request with a new key after reviewing Razorpay.", 409);
  if (reservationError) return jsonError("Refund reservation could not be prepared.", 503);

  let refund: RazorpayRefund;
  try {
    refund = await razorpayRequest<RazorpayRefund>(
      "/payments/" + encodeURIComponent(order.paymentId) + "/refund",
      {
        method: "POST",
        headers: { "X-Refund-Idempotency": idempotencyKey },
        body: JSON.stringify({
          amount: amountPaise,
          speed: "normal",
          receipt: "PKR-" + idempotencyKey.slice(0, 28),
          notes: { order_number: String(order.orderNumber ?? orderId), refund_request_id: idempotencyKey, initiated_by: "pokhars_admin" },
        }),
      },
      mode,
    );
  } catch {
    // The request may have reached Razorpay even if the response timed out.
    // Keep the reservation and reuse the same idempotency key on retry.
    await requestRef.update({ state: "pending", lastError: "Gateway response uncertain; retry with the same key.", updatedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
    return jsonError("Razorpay’s response is uncertain. Retry this same refund request; do not create another key.", 503);
  }
  if (!refund.id || refund.payment_id !== order.paymentId || refund.amount !== amountPaise) {
    await requestRef.update({ state: "pending", lastError: "Refund response needs reconciliation.", updatedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
    return jsonError("Razorpay returned a refund response that needs reconciliation. Retry with the same key.", 502);
  }

  await requestRef.update({
    state: "submitted", refundId: refund.id, refundStatus: refund.status,
    submittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  await db.collection("refunds").doc(refund.id).set({
    refundId: refund.id, refundRequestId: idempotencyKey, orderId, paymentId: order.paymentId,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  if (refund.status === "processed") await settleRefundRequest(idempotencyKey, refund.id, "processed");
  else if (refund.status === "failed") await settleRefundRequest(idempotencyKey, refund.id, "failed");
  return Response.json({ ok: true, refundId: refund.id, amountPaise, status: refund.status, processed: refund.status === "processed" }, {
    status: refund.status === "processed" || refund.status === "failed" ? 200 : 202,
  });
}
