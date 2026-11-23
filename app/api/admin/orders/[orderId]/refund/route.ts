import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminOrResponse, isResponse, jsonError } from "@/lib/firebase/admin";
import { razorpayRequest, type RazorpayMode } from "@/lib/firebase/razorpay";
import { sendTransactionalEmail } from "@/lib/notifications/email";

export const runtime = "nodejs";
type Context = { params: Promise<{ orderId: string }> };
type RazorpayPayment = { id: string; amount: number; currency: string; status: string };
type RazorpayRefund = { id: string; amount: number; payment_id: string; status: string; created_at?: number };
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
  if (payload.amountPaise !== undefined && (!Number.isSafeInteger(payload.amountPaise) || Number(payload.amountPaise) < 100)) {
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
  const mode: RazorpayMode = order.paymentMode === "live" ? "live" : "test";
  if (order.paymentMode !== "test" && order.paymentMode !== "live") return jsonError("This order's payment mode cannot be refunded through Razorpay.", 409);

  let payment: RazorpayPayment;
  let refunds: RazorpayRefund[];
  try {
    payment = await razorpayRequest<RazorpayPayment>("/payments/" + encodeURIComponent(order.paymentId), {}, mode);
    const list = await razorpayRequest<RefundList>("/payments/" + encodeURIComponent(order.paymentId) + "/refunds", {}, mode);
    refunds = Array.isArray(list.items) ? list.items : [];
  } catch (cause) {
    return jsonError(cause instanceof Error ? cause.message : "Razorpay could not verify this payment.", 503);
  }
  if (payment.status !== "captured" || payment.id !== order.paymentId || payment.currency !== "INR" || payment.amount !== Number(order.totalPaise)) {
    return jsonError("Razorpay payment details do not match this captured order.", 409);
  }
  const gatewayRefundedPaise = refunds.filter((item) => item.status !== "failed").reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const refundRef = db.collection("refundRequests").doc(idempotencyKey);
  const priorRefund = await refundRef.get();
  if (priorRefund.exists && priorRefund.data()?.state === "completed") {
    const prior = priorRefund.data()!;
    if (prior.orderId !== orderId) return jsonError("This refund key was already used for another order.", 409);
    return Response.json({ ok: true, refundId: prior.refundId, amountPaise: prior.amountPaise, status: prior.refundStatus, duplicate: true });
  }

  let amountPaise = Number(payload.amountPaise ?? 0);
  let completedDuplicate: { refundId: string; amountPaise: number; refundStatus: string } | null = null;
  let conflict: string | null = null;
  const reserved = await db.runTransaction(async (transaction) => {
    const [latestOrder, requestSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(refundRef)]);
    if (!latestOrder.exists) throw new Error("ORDER_NOT_FOUND");
    const current = latestOrder.data()!;
    if (requestSnapshot.exists) {
      const prior = requestSnapshot.data()!;
      if (prior.orderId !== orderId) throw new Error("REFUND_KEY_CONFLICT");
      if (prior.state === "completed") {
        completedDuplicate = { refundId: String(prior.refundId), amountPaise: Number(prior.amountPaise), refundStatus: String(prior.refundStatus) };
        return { alreadyReserved: true };
      }
      if (prior.state === "pending") {
        if (payload.amountPaise !== undefined && Number(payload.amountPaise) !== Number(prior.amountPaise)) throw new Error("REFUND_KEY_CONFLICT");
        amountPaise = Number(prior.amountPaise);
        return { alreadyReserved: true };
      }
      amountPaise = Number(prior.amountPaise);
    } else {
      if (!amountPaise) amountPaise = Number(current.totalPaise) - Math.max(Number(current.refundedPaise ?? 0), gatewayRefundedPaise) - Number(current.refundsInFlightPaise ?? 0);
      const remaining = Number(current.totalPaise) - Math.max(Number(current.refundedPaise ?? 0), gatewayRefundedPaise) - Number(current.refundsInFlightPaise ?? 0);
      if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > remaining) throw new Error("REFUND_AMOUNT_INVALID");
      transaction.create(refundRef, {
        orderId, orderNumber: current.orderNumber ?? orderId, amountPaise, reason,
        idempotencyKey, state: "pending", createdAt: FieldValue.serverTimestamp(),
        createdBy: access.uid,
      });
      transaction.update(orderRef, { refundsInFlightPaise: FieldValue.increment(amountPaise), updatedAt: FieldValue.serverTimestamp() });
      return { alreadyReserved: false };
    }

    const remaining = Number(current.totalPaise) - Math.max(Number(current.refundedPaise ?? 0), gatewayRefundedPaise) - Number(current.refundsInFlightPaise ?? 0);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > remaining) throw new Error("REFUND_AMOUNT_INVALID");
    transaction.update(refundRef, { state: "pending", reason, updatedAt: FieldValue.serverTimestamp() });
    transaction.update(orderRef, { refundsInFlightPaise: FieldValue.increment(amountPaise), updatedAt: FieldValue.serverTimestamp() });
    return { alreadyReserved: false };
  }).catch((cause) => {
    const code = cause instanceof Error ? cause.message : "";
    conflict = code;
    return { alreadyReserved: true };
  });

  if (completedDuplicate) {
    return Response.json({ ok: true, refundId: completedDuplicate.refundId, amountPaise: completedDuplicate.amountPaise, status: completedDuplicate.refundStatus, duplicate: true });
  }
  if (conflict === "ORDER_NOT_FOUND") return jsonError("Order not found.", 404);
  if (conflict === "REFUND_KEY_CONFLICT") return jsonError("This idempotency key is already associated with a different refund request.", 409);
  if (conflict === "REFUND_AMOUNT_INVALID") return jsonError("The requested amount exceeds the remaining refundable balance.", 409);

  try {
    const refund = await razorpayRequest<RazorpayRefund>(
      "/payments/" + encodeURIComponent(order.paymentId) + "/refund",
      {
        method: "POST",
        headers: { "X-Refund-Idempotency": idempotencyKey },
        body: JSON.stringify({
          amount: amountPaise,
          speed: "normal",
          receipt: "PKR-" + idempotencyKey.slice(0, 28),
          notes: { order_number: String(order.orderNumber ?? orderId), initiated_by: "pokhars_admin" },
        }),
      },
      mode,
    );
    if (refund.payment_id !== order.paymentId || refund.amount !== amountPaise || !refund.id) throw new Error("Razorpay returned a refund that did not match this request.");

    const latestOrder = await orderRef.get();
    if (!latestOrder.exists) throw new Error("Order disappeared after refund response.");
    const current = latestOrder.data()!;
    const refundedPaise = Number(current.refundedPaise ?? 0) + amountPaise;
    const fullyRefunded = refundedPaise >= Number(current.totalPaise);
    await db.runTransaction(async (transaction) => {
      const [latest, requestDoc] = await Promise.all([transaction.get(orderRef), transaction.get(refundRef)]);
      if (!latest.exists || !requestDoc.exists) throw new Error("Refund record could not be finalised.");
      const latestData = latest.data()!;
      const nextRefunded = Number(latestData.refundedPaise ?? 0) + amountPaise;
      const full = nextRefunded >= Number(latestData.totalPaise);
      transaction.update(orderRef, {
        refundedPaise: nextRefunded,
        refundsInFlightPaise: Math.max(0, Number(latestData.refundsInFlightPaise ?? 0) - amountPaise),
        paymentStatus: full ? "refunded" : "partially_refunded",
        ...(full ? { status: "refunded" } : {}),
        refunds: FieldValue.arrayUnion({
          refundId: refund.id, amountPaise, status: refund.status,
          reason, createdAt: new Date().toISOString(),
        }),
        statusHistory: FieldValue.arrayUnion({
          status: full ? "refunded" : String(latestData.status ?? "confirmed"),
          event: "refund_requested",
          note: full ? "A full refund was initiated through Razorpay." : "A partial refund was initiated through Razorpay.",
          occurredAt: new Date().toISOString(),
        }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(refundRef, {
        state: "completed",
        refundId: refund.id,
        refundStatus: refund.status,
        completedAt: FieldValue.serverTimestamp(),
      });
    });

    if (typeof order.customerEmail === "string" && order.customerEmail) {
      const result = await sendTransactionalEmail({
        to: order.customerEmail,
        orderNumber: String(order.orderNumber ?? orderId),
        subject: "POKHAR’S refund update",
        heading: "Refund initiated",
        message: "A refund of " + (amountPaise / 100).toFixed(2) + " has been requested for your POKHAR’S order. Razorpay refund status: " + String(refund.status) + ". Your bank may take several working days to reflect it.",
      });
      await orderRef.update({ refundEmailStatus: result.ok ? "sent" : result.reason, updatedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
    }
    return Response.json({ ok: true, refundId: refund.id, amountPaise, status: refund.status });
  } catch (cause) {
    await db.runTransaction(async (transaction) => {
      const [latest, requestDoc] = await Promise.all([transaction.get(orderRef), transaction.get(refundRef)]);
      if (latest.exists && requestDoc.exists && requestDoc.data()?.state === "pending") {
        transaction.update(orderRef, { refundsInFlightPaise: Math.max(0, Number(latest.data()?.refundsInFlightPaise ?? 0) - amountPaise), updatedAt: FieldValue.serverTimestamp() });
        transaction.update(refundRef, { state: "failed", failure: "Razorpay refund request did not return a verified result.", updatedAt: FieldValue.serverTimestamp() });
      }
    }).catch(() => undefined);
    return jsonError(cause instanceof Error ? cause.message : "Razorpay refund failed. Retry with a new refund request.", 502);
  }
}
