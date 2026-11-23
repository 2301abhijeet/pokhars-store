import { createHash, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, jsonError } from "@/lib/firebase/admin";
import { sendTransactionalEmail } from "@/lib/notifications/email";

export const runtime = "nodejs";

function tokenMatches(expected: string, supplied: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.SHIPROCKET_WEBHOOK_TOKEN ?? "";
  if (!expected || !tokenMatches(expected, request.headers.get("x-api-key") ?? "")) {
    return jsonError("Invalid courier webhook token.", 401);
  }
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid courier webhook payload.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError("Invalid courier webhook payload.", 400);
  const payload = body as Record<string, unknown>;
  const awb = typeof payload.awb === "string" ? payload.awb.trim() : "";
  const shipmentId = payload.shipment_id == null ? "" : String(payload.shipment_id);
  const courier = typeof payload.courier_name === "string" && payload.courier_name.trim() ? payload.courier_name.trim() : "Shiprocket";
  const rawStatus = String(payload.current_status ?? payload.shipment_status ?? payload.status ?? "UPDATED").trim();
  const normalized = rawStatus.toLowerCase();
  const trackingUrl = typeof payload.tracking_url === "string" && payload.tracking_url.startsWith("https://") ? payload.tracking_url : "";

  const db = adminDb();
  const eventId = createHash("sha256").update(JSON.stringify({ awb, shipmentId, rawStatus, payload })).digest("hex");
  const eventRef = db.collection("courierWebhookEvents").doc(eventId);
  const existingEvent = await eventRef.get();
  if (existingEvent.exists) return Response.json({ received: true, duplicate: true });

  let matches = awb
    ? await db.collection("orders").where("shiprocketAwb", "==", awb).limit(1).get()
    : await db.collection("orders").where("shiprocketShipmentId", "==", shipmentId).limit(1).get();
  if (matches.empty && shipmentId) {
    matches = await db.collection("orders").where("shiprocketShipmentId", "==", shipmentId).limit(1).get();
  }
  const orderDoc = matches.docs[0];
  if (!orderDoc) {
    await eventRef.set({
      state: "unmatched", awb: awb || null, shipmentId: shipmentId || null,
      rawStatus, createdAt: FieldValue.serverTimestamp(),
    });
    return Response.json({ received: true, unmatched: true });
  }

  const order = orderDoc.data();
  if (order.paymentMode === "test" || order.demoOrder === true || order.paymentStatus !== "paid") {
    await eventRef.set({ state: "ignored_test_or_unpaid", orderId: orderDoc.id, createdAt: FieldValue.serverTimestamp() });
    return Response.json({ received: true, ignored: true });
  }
  const nextStatus = normalized.includes("delivered") ? "delivered"
    : normalized.includes("transit") || normalized.includes("out for delivery") || normalized.includes("shipped") || normalized.includes("picked up") ? "shipped"
    : null;
  const previousStatus = String(order.status ?? "");
  const changed = nextStatus !== null && nextStatus !== previousStatus;

  await db.runTransaction(async (transaction) => {
    const [latest, eventSnapshot] = await Promise.all([
      transaction.get(orderDoc.ref),
      transaction.get(eventRef),
    ]);
    if (eventSnapshot.exists || !latest.exists) return;
    const latestOrder = latest.data()!;
    if (latestOrder.paymentMode === "test" || latestOrder.demoOrder === true || latestOrder.paymentStatus !== "paid") return;
    const updates: Record<string, unknown> = {
      shiprocketStatus: rawStatus,
      shiprocketStatusUpdatedAt: FieldValue.serverTimestamp(),
      carrier: courier,
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: nextStatus ?? String(latestOrder.status ?? "confirmed"),
        event: "courier_status_update",
        note: "Courier update: " + rawStatus,
        occurredAt: new Date().toISOString(),
      }),
    };
    if (awb) {
      updates.shiprocketAwb = awb;
      updates.trackingNumber = awb;
    }
    if (trackingUrl) updates.trackingUrl = trackingUrl;
    if (nextStatus && ["shipped", "delivered"].includes(nextStatus) && nextStatus !== latestOrder.status) {
      updates.status = nextStatus;
    }
    transaction.update(orderDoc.ref, updates);
    transaction.set(eventRef, {
      state: "processed", orderId: orderDoc.id,
      awb: awb || null, shipmentId: shipmentId || null, rawStatus,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  if (changed && typeof order.customerEmail === "string" && order.customerEmail) {
    const email = await sendTransactionalEmail({
      to: order.customerEmail,
      orderNumber: String(order.orderNumber ?? orderDoc.id),
      subject: "POKHAR’S delivery update",
      heading: nextStatus === "delivered" ? "Your order was delivered" : "Your order is on the way",
      message: nextStatus === "delivered"
        ? "The courier has marked your order as delivered."
        : "Courier status: " + rawStatus + ". Tracking number: " + (awb || "updating") + (trackingUrl ? ". Track it here: " + trackingUrl : "."),
    });
    await orderDoc.ref.update({
      shippingNotificationEmailStatus: email.ok ? "sent" : email.reason,
      shippingNotificationEmailUpdatedAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined);
  }
  return Response.json({ received: true });
}
