import { adminDb, jsonError, verifySignedInUser } from "@/lib/firebase/admin";

export const runtime = "nodejs";

function isoValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    try { return (value as { toDate: () => Date }).toDate().toISOString(); } catch { return null; }
  }
  return null;
}

/**
 * A customer can only retrieve their own order history.
 * Identity always comes from the verified Firebase ID token, never a browser-supplied UID.
 */
export async function GET(request: Request) {
  const user = await verifySignedInUser(request);
  if (!user) return jsonError("Sign in to view your order history.", 401);

  try {
    const snapshot = await adminDb()
      .collection("orders")
      .where("userId", "==", user.uid)
      .limit(50)
      .get();

    const orders = snapshot.docs.map((document) => {
      const data = document.data();
      const createdAt = isoValue(data.createdAt);
      const items = Array.isArray(data.items)
        ? data.items.slice(0, 20).map((item: Record<string, unknown>) => ({
            productId: String(item.productId ?? ""),
            name: String(item.nameSnapshot ?? "POKHAR’S product"),
            quantity: Number(item.quantity) || 0,
            unitPricePaise: Number(item.unitPricePaise) || 0,
            lineTotalPaise: Number(item.lineTotalPaise) || 0,
          }))
        : [];
      const statusHistory = Array.isArray(data.statusHistory)
        ? data.statusHistory.slice(-30).map((event: Record<string, unknown>) => ({
            status: String(event.status ?? ""),
            event: typeof event.event === "string" ? event.event : undefined,
            note: typeof event.note === "string" ? event.note : "",
            occurredAt: isoValue(event.occurredAt),
          }))
        : [];
      const rawTrackingUrl = typeof data.trackingUrl === "string" ? data.trackingUrl : "";
      let trackingUrl: string | null = null;
      try {
        if (rawTrackingUrl && new URL(rawTrackingUrl).protocol === "https:") trackingUrl = rawTrackingUrl;
      } catch { /* omit malformed tracking links */ }

      return {
        id: document.id,
        orderNumber: String(data.orderNumber ?? document.id),
        status: String(data.status ?? "pending_payment"),
        paymentStatus: String(data.paymentStatus ?? "created"),
        paymentMode: data.paymentMode === "test" ? "test" : "live",
        subtotalPaise: Number(data.subtotalPaise) || 0,
        shippingPaise: Number(data.shippingPaise) || 0,
        totalPaise: Number(data.totalPaise) || 0,
        carrier: typeof data.carrier === "string" ? data.carrier : null,
        trackingNumber: typeof data.trackingNumber === "string" ? data.trackingNumber : null,
        trackingUrl,
        statusHistory,
        createdAt,
        items,
      };
    });

    orders.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return Response.json({ orders }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return jsonError("Your order history is temporarily unavailable. Please try again.", 503);
  }
}
