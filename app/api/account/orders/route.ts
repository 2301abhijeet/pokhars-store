import { adminDb, jsonError, verifySignedInUser } from "@/lib/firebase/admin";

export const runtime = "nodejs";

/**
 * A customer can only retrieve their own order history.
 * Never accept a userId from the browser; identity comes from the verified token.
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
      const createdAt = data.createdAt && typeof data.createdAt.toDate === "function"
        ? data.createdAt.toDate().toISOString()
        : null;
      const items = Array.isArray(data.items)
        ? data.items.slice(0, 20).map((item: Record<string, unknown>) => ({
            productId: String(item.productId ?? ""),
            name: String(item.nameSnapshot ?? "POKHAR’S product"),
            quantity: Number(item.quantity) || 0,
            unitPricePaise: Number(item.unitPricePaise) || 0,
            lineTotalPaise: Number(item.lineTotalPaise) || 0,
          }))
        : [];

      return {
        id: document.id,
        orderNumber: String(data.orderNumber ?? document.id),
        status: String(data.status ?? "pending_payment"),
        paymentStatus: String(data.paymentStatus ?? "created"),
        paymentMode: data.paymentMode === "test" ? "test" : "live",
        subtotalPaise: Number(data.subtotalPaise) || 0,
        shippingPaise: Number(data.shippingPaise) || 0,
        totalPaise: Number(data.totalPaise) || 0,
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
