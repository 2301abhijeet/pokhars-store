import { adminDb, adminOrResponse, isResponse, jsonError } from "@/lib/firebase/admin";
import { isRecord } from "@/lib/firebase/admin-validation";
import { sendTransactionalEmail } from "@/lib/notifications/email";

export const runtime = "nodejs";

type Context = { params: Promise<{ orderId: string }> };

const previewCopy = {
  processing: {
    subject: "[TEST] POKHAR’S order status update — Processing",
    heading: "Preview: Your order is being prepared",
    message: "This is a sample of the Processing update customers would receive while their POKHAR’S order is being prepared.",
  },
  shipped: {
    subject: "[TEST] POKHAR’S order status update — Shipped",
    heading: "Preview: Your order has shipped",
    message: "This is a sample of the Shipped update customers would receive after a parcel is handed to the courier.",
  },
  delivered: {
    subject: "[TEST] POKHAR’S order status update — Delivered",
    heading: "Preview: Your order was delivered",
    message: "This is a sample of the Delivered update customers would receive after delivery is confirmed.",
  },
} as const;

export async function POST(request: Request, context: Context) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  if (!isRecord(body) || Object.keys(body).some((key) => key !== "status")) {
    return jsonError("Only a test email status can be selected.", 400);
  }

  const status = body.status;
  if (status !== "processing" && status !== "shipped" && status !== "delivered") {
    return jsonError("Choose Processing, Shipped or Delivered for the test email.", 400);
  }

  const { orderId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) {
    return jsonError("Invalid order reference.", 400);
  }

  const snapshot = await adminDb().collection("orders").doc(orderId).get();
  if (!snapshot.exists) return jsonError("Order not found.", 404);

  const order = snapshot.data()!;
  if (order.paymentMode !== "test" || order.paymentStatus !== "paid") {
    return jsonError("Sample status emails are available only for captured test orders.", 409);
  }

  const customerEmail = typeof order.customerEmail === "string" ? order.customerEmail.trim() : "";
  if (!customerEmail) return jsonError("This test order has no customer email address saved.", 409);

  const copy = previewCopy[status];
  const email = await sendTransactionalEmail({
    to: customerEmail,
    subject: copy.subject,
    heading: copy.heading,
    message: copy.message + " This is a preview email only. Your actual order status has not changed, no shipment has been booked, and no parcel has been delivered.",
    orderNumber: String(order.orderNumber ?? orderId),
    footer: "POKHAR’S · Test notification only. No order or fulfilment data was changed.",
  }).catch(() => ({ ok: false as const, reason: "provider_error" as const }));

  if (!email.ok) {
    return jsonError("The sample status email could not be sent (" + email.reason + ").", 502);
  }

  return Response.json({ ok: true, status, emailId: email.id });
}
