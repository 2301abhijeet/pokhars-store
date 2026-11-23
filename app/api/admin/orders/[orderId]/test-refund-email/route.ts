import { adminDb, adminOrResponse, isResponse, jsonError } from "@/lib/firebase/admin";
import { isRecord } from "@/lib/firebase/admin-validation";
import { sendTransactionalEmail } from "@/lib/notifications/email";

export const runtime = "nodejs";

type Context = { params: Promise<{ orderId: string }> };

const sampleEmails = {
  processed: {
    subject: "[TEST] POKHAR’S refund processed",
    heading: "Preview: Your refund has been processed",
    message: "This is a sample refund confirmation for ₹1.00. In a real refund, Razorpay would confirm that the refund was processed. Your bank or card issuer may take additional working days to reflect it.",
  },
  failed: {
    subject: "[TEST] POKHAR’S refund failed",
    heading: "Preview: Your refund could not be processed",
    message: "This is a sample refund failure notification for ₹1.00. In a real refund, the payment provider would report that the refund could not be processed and POKHAR’S support would help you with the next step.",
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

  if (!isRecord(body) || Object.keys(body).some((key) => key !== "outcome")) {
    return jsonError("Only a sample refund email outcome can be selected.", 400);
  }

  const outcome = body.outcome;
  if (outcome !== "processed" && outcome !== "failed") {
    return jsonError("Choose processed or failed for the sample refund email.", 400);
  }

  const { orderId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) {
    return jsonError("Invalid order reference.", 400);
  }

  const snapshot = await adminDb().collection("orders").doc(orderId).get();
  if (!snapshot.exists) return jsonError("Order not found.", 404);

  const order = snapshot.data()!;
  if (order.paymentMode !== "test" || order.paymentStatus !== "paid") {
    return jsonError("Sample refund emails are available only for captured test orders.", 409);
  }

  const customerEmail = typeof order.customerEmail === "string" ? order.customerEmail.trim() : "";
  if (!customerEmail) return jsonError("This test order has no customer email address saved.", 409);

  const sample = sampleEmails[outcome];
  const email = await sendTransactionalEmail({
    to: customerEmail,
    subject: sample.subject,
    heading: sample.heading,
    message: sample.message + " This is a preview email only. No refund was requested from Razorpay, no payment was returned, and your order or refund records were not changed.",
    orderNumber: String(order.orderNumber ?? orderId),
    footer: "POKHAR’S · Test notification only. No actual refund or order change was performed.",
  }).catch(() => ({ ok: false as const, reason: "provider_error" as const }));

  if (!email.ok) {
    return jsonError("The sample refund email could not be sent (" + email.reason + ").", 502);
  }

  return Response.json({ ok: true, outcome, emailId: email.id });
}
