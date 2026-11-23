import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { sendTransactionalEmail } from "@/lib/notifications/email";

export async function settleRefundRequest(
  refundRequestId: string,
  refundId: string,
  outcome: "processed" | "failed",
) {
  const db = adminDb();
  const requestRef = db.collection("refundRequests").doc(refundRequestId);
  const email = await db.runTransaction(async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists) return;
    const request = requestSnapshot.data()!;
    if (request.state === "processed" || request.state === "failed") return;
    if (!["pending", "submitted"].includes(String(request.state)) || typeof request.orderId !== "string") return;

    const orderRef = db.collection("orders").doc(request.orderId);
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) return;
    const order = orderSnapshot.data()!;
    const amountPaise = Number(request.amountPaise);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) return;

    const refundsInFlightPaise = Math.max(0, Number(order.refundsInFlightPaise ?? 0) - amountPaise);
    if (outcome === "processed") {
      const refundedPaise = Number(order.refundedPaise ?? 0) + amountPaise;
      const full = refundedPaise >= Number(order.totalPaise);
      transaction.update(orderRef, {
        refundedPaise,
        refundsInFlightPaise,
        paymentStatus: full ? "refunded" : "partially_refunded",
        ...(full ? { status: "refunded" } : {}),
        refunds: FieldValue.arrayUnion({
          refundId, amountPaise, status: "processed",
          reason: String(request.reason ?? "Admin initiated refund"),
          createdAt: new Date().toISOString(),
        }),
        statusHistory: FieldValue.arrayUnion({
          status: full ? "refunded" : String(order.status ?? "confirmed"),
          event: "refund_processed",
          note: full ? "Razorpay processed a full refund." : "Razorpay processed a partial refund.",
          occurredAt: new Date().toISOString(),
        }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(requestRef, {
        state: "processed", refundId, refundStatus: "processed",
        processedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      transaction.update(orderRef, { refundsInFlightPaise, updatedAt: FieldValue.serverTimestamp() });
      transaction.update(requestRef, {
        state: "failed", refundId, refundStatus: "failed",
        failedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
    }

    if (typeof order.customerEmail === "string" && order.customerEmail) {
      return {
        to: order.customerEmail,
        orderNumber: String(order.orderNumber ?? request.orderId),
        amountPaise, outcome, orderId: request.orderId,
      };
    }
    return null;
  });

  if (email) {
    const result = await sendTransactionalEmail({
      to: email.to,
      orderNumber: email.orderNumber,
      subject: email.outcome === "processed" ? "POKHAR’S refund processed" : "POKHAR’S refund failed",
      heading: email.outcome === "processed" ? "Your refund has been processed" : "Your refund could not be processed",
      message: email.outcome === "processed"
        ? "Razorpay has processed your refund of ₹" + (email.amountPaise / 100).toFixed(2) + ". Your bank or card issuer may take additional working days to reflect it."
        : "Razorpay could not process the requested refund of ₹" + (email.amountPaise / 100).toFixed(2) + ". Please contact POKHAR’S support for assistance.",
    });
    await db.collection("orders").doc(email.orderId).update({
      refundEmailStatus: result.ok ? "sent" : result.reason,
      refundEmailUpdatedAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined);
  }
}
