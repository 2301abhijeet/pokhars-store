import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminOrResponse, isResponse, jsonError } from "@/lib/firebase/admin";
import { orderStatuses, isRecord } from "@/lib/firebase/admin-validation";

export const runtime = "nodejs";

type Context = { params: Promise<{ orderId: string }> };
const manageableStatuses = new Set(["confirmed", "processing", "shipped", "delivered"]);

export async function PATCH(request: Request, context: Context) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid JSON body.", 400); }
  const { orderId } = await context.params;
  if (!isRecord(body) || !orderStatuses.includes(body.status as (typeof orderStatuses)[number])) return jsonError("Choose a valid order status.", 400);
  const ref = adminDb().collection("orders").doc(orderId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return jsonError("Order not found.", 404);
  const order = snapshot.data();
  const currentStatus = order?.status;
  if (order?.paymentStatus !== "paid") {
    return jsonError("Only paid orders can move through fulfilment statuses.", 409);
  }
  if (!manageableStatuses.has(String(body.status)) ||
      !(currentStatus === "confirmed" || currentStatus === "processing" || currentStatus === "shipped") ||
      (body.status === "processing" && currentStatus !== "confirmed") ||
      (body.status === "shipped" && currentStatus !== "processing") ||
      (body.status === "delivered" && currentStatus !== "shipped")) {
    return jsonError("This order status change is not supported. Payment and refund states are managed separately.", 409);
  }
  await ref.update({ status: body.status, updatedAt: FieldValue.serverTimestamp() });
  return Response.json({ ok: true });
}
