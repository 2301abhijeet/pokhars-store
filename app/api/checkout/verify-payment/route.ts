import { adminDb, jsonError, verifySignedInUser } from "@/lib/firebase/admin";
import {
  checkoutConfig,
  markOrderPaid,
  razorpayRequest,
  verifyCheckoutSignature,
} from "@/lib/firebase/razorpay";

export const runtime = "nodejs";

type RazorpayPayment = {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
};

export async function POST(request: Request) {
  const user = await verifySignedInUser(request);
  if (!user) return jsonError("Sign in before verifying your payment.", 401);
  const config = checkoutConfig();
  if (!config.enabled) return jsonError("Test checkout is not configured. Live payments are disabled.", 503);

  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid payment response.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError("Invalid payment response.", 400);
  const payload = body as Record<string, unknown>;
  const { orderId, razorpay_order_id: razorpayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = payload;
  if (typeof orderId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(orderId) ||
      typeof razorpayOrderId !== "string" || !/^order_[A-Za-z0-9]+$/.test(razorpayOrderId) ||
      typeof paymentId !== "string" || !/^pay_[A-Za-z0-9]+$/.test(paymentId) ||
      typeof signature !== "string" || !verifyCheckoutSignature(razorpayOrderId, paymentId, signature)) {
    return jsonError("The payment could not be verified. Please contact the store if money was deducted.", 400);
  }

  const db = adminDb();
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnapshot = await orderRef.get();
  if (!orderSnapshot.exists) return jsonError("The order could not be found.", 404);
  const order = orderSnapshot.data()!;
  if (order.userId !== user.uid || order.paymentMode !== "test" || order.razorpayOrderId !== razorpayOrderId) {
    return jsonError("This payment does not match your order.", 403);
  }

  try {
    const payment = await razorpayRequest<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`);
    if (payment.order_id !== razorpayOrderId || payment.amount !== order.totalPaise || payment.currency !== "INR") {
      return jsonError("Payment details do not match the order. Please contact the store.", 409);
    }
    if (payment.status === "captured") {
      await markOrderPaid(orderRef, payment.id);
      return Response.json({ status: "paid", orderNumber: order.orderNumber, mode: "test" });
    }
    if (payment.status === "failed") {
      // Another payment attempt may still be active. Keep the reservation until
      // the order expires and Razorpay confirms that no attempt was captured.
      return Response.json({ status: "failed", message: "The test payment failed. You can try again from your bag." }, { status: 402 });
    }
    await orderRef.update({ paymentAttemptStatus: payment.status, updatedAt: new Date() });
    return Response.json({ status: "processing", message: "Payment is still processing. Refresh Orders in a moment." }, { status: 202 });
  } catch {
    return jsonError("Payment verification is temporarily unavailable. Your order is still being checked.", 503);
  }
}
