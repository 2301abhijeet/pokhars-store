import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminOrResponse, isResponse, jsonError } from "@/lib/firebase/admin";
import { orderStatuses, isRecord } from "@/lib/firebase/admin-validation";

export const runtime = "nodejs";

type Context = { params: Promise<{ orderId: string }> };
const manageableStatuses = new Set(["confirmed", "processing", "shipped", "delivered"]);
const allowedBodyFields = new Set(["status", "carrier", "trackingNumber", "trackingUrl"]);

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  return clean && clean.length <= maxLength ? clean : undefined;
}

export async function PATCH(request: Request, context: Context) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;

  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid JSON body.", 400); }
  const { orderId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) return jsonError("Invalid order reference.", 400);
  if (!isRecord(body) || Object.keys(body).some((key) => !allowedBodyFields.has(key))) {
    return jsonError("Only order status and courier tracking fields can be updated.", 400);
  }
  if (!orderStatuses.includes(body.status as (typeof orderStatuses)[number])) {
    return jsonError("Choose a valid order status.", 400);
  }

  const carrier = optionalText(body.carrier, 80);
  const trackingNumber = optionalText(body.trackingNumber, 120);
  const trackingUrl = optionalText(body.trackingUrl, 500);
  if (body.carrier !== undefined && carrier === undefined) return jsonError("Courier name must be 80 characters or fewer.", 400);
  if (body.trackingNumber !== undefined && trackingNumber === undefined) return jsonError("Tracking number must be 120 characters or fewer.", 400);
  if (body.trackingUrl !== undefined && trackingUrl === undefined) return jsonError("Tracking link must be a valid HTTPS URL.", 400);
  if (trackingUrl) {
    try {
      if (new URL(trackingUrl).protocol !== "https:") return jsonError("Tracking links must use HTTPS.", 400);
    } catch {
      return jsonError("Enter a valid HTTPS tracking link.", 400);
    }
  }

  const ref = adminDb().collection("orders").doc(orderId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return jsonError("Order not found.", 404);
  const order = snapshot.data()!;
  const currentStatus = String(order.status ?? "");

  if (order.paymentStatus !== "paid") return jsonError("Only paid orders can move through fulfilment statuses.", 409);
  if (order.paymentMode === "test") return jsonError("Test payment orders cannot enter fulfilment.", 409);
  if (order.inventoryIssue) return jsonError("Resolve the inventory issue before moving this order into fulfilment.", 409);

  const requestedStatus = String(body.status);
  const statusChanged = requestedStatus !== currentStatus;
  const trackingChanged = body.carrier !== undefined || body.trackingNumber !== undefined || body.trackingUrl !== undefined;

  if (statusChanged) {
    const allowedTransition =
      (currentStatus === "confirmed" && requestedStatus === "processing") ||
      (currentStatus === "processing" && requestedStatus === "shipped") ||
      (currentStatus === "shipped" && requestedStatus === "delivered");
    if (!allowedTransition || !manageableStatuses.has(requestedStatus)) {
      return jsonError("Move orders in sequence: confirmed → processing → shipped → delivered.", 409);
    }
  } else if (!(currentStatus === "shipped" && trackingChanged)) {
    return jsonError("No supported order or tracking change was supplied.", 409);
  }

  const nextCarrier = carrier === undefined ? String(order.carrier ?? "") : carrier ?? "";
  const nextTrackingNumber = trackingNumber === undefined ? String(order.trackingNumber ?? "") : trackingNumber ?? "";
  const nextTrackingUrl = trackingUrl === undefined ? String(order.trackingUrl ?? "") : trackingUrl ?? "";

  if (requestedStatus === "shipped" && (!nextCarrier || !nextTrackingNumber)) {
    return jsonError("Add the courier name and tracking number before marking this order as shipped.", 400);
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

  if (statusChanged) {
    const statusNotes: Record<string, string> = {
      processing: "Your order is being prepared.",
      shipped: "Your order has been handed to the courier.",
      delivered: "Your order has been marked as delivered.",
    };
    updates.status = requestedStatus;
    updates.statusHistory = FieldValue.arrayUnion({
      status: requestedStatus,
      note: statusNotes[requestedStatus],
      occurredAt: now,
    });
    if (requestedStatus === "shipped") updates.shippedAt = FieldValue.serverTimestamp();
    if (requestedStatus === "delivered") updates.deliveredAt = FieldValue.serverTimestamp();
  }

  if (trackingChanged) {
    if (carrier !== undefined) updates.carrier = nextCarrier || FieldValue.delete();
    if (trackingNumber !== undefined) updates.trackingNumber = nextTrackingNumber || FieldValue.delete();
    if (trackingUrl !== undefined) updates.trackingUrl = nextTrackingUrl || FieldValue.delete();
    if (!statusChanged) {
      updates.statusHistory = FieldValue.arrayUnion({
        status: "shipped",
        event: "tracking_updated",
        note: "Courier tracking information was updated.",
        occurredAt: now,
      });
    }
  }

  await ref.update(updates);
  return Response.json({ ok: true, status: requestedStatus });
}
