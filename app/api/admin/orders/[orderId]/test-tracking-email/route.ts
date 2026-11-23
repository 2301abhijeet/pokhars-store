import { adminDb, adminOrResponse, isResponse, jsonError } from "@/lib/firebase/admin";
import { sendTransactionalEmail } from "@/lib/notifications/email";

export const runtime = "nodejs";

type Context = { params: Promise<{ orderId: string }> };

const demoTracking = {
  carrier: "POKHARS Demo Courier",
  trackingNumber: "DEMO-AWB-2026-001",
  trackingUrl: "https://example.com/track/DEMO-AWB-2026-001",
};

export async function POST(request: Request, context: Context) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;

  const { orderId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) {
    return jsonError("Invalid order reference.", 400);
  }

  const snapshot = await adminDb().collection("orders").doc(orderId).get();
  if (!snapshot.exists) return jsonError("Order not found.", 404);

  const order = snapshot.data()!;
  if (order.paymentMode !== "test" || order.paymentStatus !== "paid") {
    return jsonError("Sample tracking emails are available only for captured test orders.", 409);
  }

  const customerEmail = typeof order.customerEmail === "string" ? order.customerEmail.trim() : "";
  if (!customerEmail) return jsonError("This test order has no customer email address saved.", 409);

  const email = await sendTransactionalEmail({
    to: customerEmail,
    subject: "[TEST] POKHAR’S courier tracking details",
    heading: "Preview: Your tracking details are ready",
    orderNumber: String(order.orderNumber ?? orderId),
    message:
      "Courier: " + demoTracking.carrier +
      ". Tracking / AWB number: " + demoTracking.trackingNumber +
      ". Sample tracking link: " + demoTracking.trackingUrl +
      ". This is a preview email only. These are demonstration details; no real courier order, AWB assignment, pickup or parcel dispatch has taken place.",
    footer: "POKHAR’S · Test notification only. No order or fulfilment data was changed.",
  }).catch(() => ({ ok: false as const, reason: "provider_error" as const }));

  if (!email.ok) {
    return jsonError("The sample tracking email could not be sent (" + email.reason + ").", 502);
  }

  return Response.json({ ok: true, emailId: email.id, demoTracking });
}
