import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb, jsonError, verifySignedInUser } from "@/lib/firebase/admin";
import { checkoutConfig, razorpayRequest, releaseExpiredReservations, releaseReservation } from "@/lib/firebase/razorpay";
import { isPlaceholderProductValue, isValidFssaiNumber } from "@/lib/firebase/admin-validation";

export const runtime = "nodejs";

type RequestedItem = { productId: string; quantity: number };
type RazorpayOrder = { id: string; amount: number; currency: string; receipt: string };

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(value);
}

export async function POST(request: Request) {
  const user = await verifySignedInUser(request);
  if (!user) return jsonError("Sign in before checkout.", 401);
  const config = checkoutConfig();
  if (!config.enabled) return jsonError("Test checkout is not configured yet. Live payments are disabled.", 503);

  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid checkout request.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError("Invalid checkout request.", 400);
  const payload = body as { addressId?: unknown; requestId?: unknown; items?: unknown };
  if (!validRequestId(payload.requestId) || typeof payload.addressId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(payload.addressId)) {
    return jsonError("Choose a saved delivery address and retry checkout.", 400);
  }
  if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 20) return jsonError("Your bag must contain between 1 and 20 products.", 400);
  const items: RequestedItem[] = [];
  const seen = new Set<string>();
  for (const candidate of payload.items) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return jsonError("Invalid product in bag.", 400);
    const item = candidate as { productId?: unknown; quantity?: unknown };
    if (typeof item.productId !== "string" || !/^[A-Za-z0-9_-]{1,150}$/.test(item.productId) ||
        !Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 20 || seen.has(item.productId)) {
      return jsonError("A product quantity or identifier is invalid.", 400);
    }
    seen.add(item.productId);
    items.push({ productId: item.productId, quantity: Number(item.quantity) });
  }

  const db = adminDb();
  await releaseExpiredReservations();
  const checkoutRequestRef = db.collection("checkoutRequests").doc(`${user.uid}-${payload.requestId}`);
  const prior = await checkoutRequestRef.get();
  if (prior.exists && prior.data()?.state === "ready" && typeof prior.data()?.orderId === "string") {
    const order = await db.collection("orders").doc(prior.data()!.orderId).get();
    if (order.exists && typeof order.data()?.razorpayOrderId === "string") {
      return Response.json({
        orderId: order.id,
        orderNumber: order.data()?.orderNumber,
        razorpayOrderId: order.data()?.razorpayOrderId,
        amount: order.data()?.totalPaise,
        currency: "INR",
        keyId: config.keyId,
      });
    }
  }
  if (prior.exists) return jsonError("This checkout attempt is already being processed. Refresh your bag and try again.", 409);

  const addressRef = db.collection("users").doc(user.uid).collection("addresses").doc(payload.addressId);
  const orderRef = db.collection("orders").doc();
  const orderNumber = `PK-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const productRefs = items.map((item) => db.collection("products").doc(item.productId));
  let prepared: {
    subtotalPaise: number;
    totalPaise: number;
    orderItems: Array<{ productId: string; nameSnapshot: string; unitPricePaise: number; quantity: number; lineTotalPaise: number }>;
    shippingAddress: Record<string, string>;
  };

  try {
    prepared = await db.runTransaction(async (transaction) => {
      const [requestSnapshot, addressSnapshot, ...productSnapshots] = await Promise.all([
        transaction.get(checkoutRequestRef),
        transaction.get(addressRef),
        ...productRefs.map((ref) => transaction.get(ref)),
      ]);
      if (requestSnapshot.exists) throw new Error("CHECKOUT_REQUEST_EXISTS");
      if (!addressSnapshot.exists) throw new Error("ADDRESS_NOT_FOUND");
      const address = addressSnapshot.data()!;
      if (typeof address.recipientName !== "string" || typeof address.phone !== "string" || typeof address.line1 !== "string" ||
          typeof address.city !== "string" || typeof address.state !== "string" || typeof address.pincode !== "string") throw new Error("ADDRESS_INVALID");
      const shippingAddress = {
        recipientName: address.recipientName,
        phone: address.phone,
        line1: address.line1,
        line2: typeof address.line2 === "string" ? address.line2 : "",
        landmark: typeof address.landmark === "string" ? address.landmark : "",
        city: address.city,
        state: address.state,
        pincode: address.pincode,
      };

      let subtotal = 0;
      const nextItems = items.map((item, index) => {
        const snapshot = productSnapshots[index];
        if (!snapshot.exists) throw new Error("PRODUCT_NOT_FOUND");
        const data = snapshot.data()!;
        const price = Number(data.pricePaise);
        const stock = Number(data.stockQuantity);
        const publishFields = ["imageUrl", "ingredients", "allergenInfo", "nutritionInfo", "manufacturerName", "manufacturerAddress"];
        const hasVerifiedPublishDetails = publishFields.every((field) => !isPlaceholderProductValue(data[field]))
          && data.packImageVerified === true
          && isValidFssaiNumber(data.fssaiLicenseNumber);
        if (data.isActive !== true || data.visibility !== "published" || !hasVerifiedPublishDetails) throw new Error("PRODUCT_UNAVAILABLE");
        if (!Number.isSafeInteger(price) || price < 1 || !Number.isSafeInteger(stock) || stock < item.quantity) throw new Error("INSUFFICIENT_STOCK");
        const lineTotal = price * item.quantity;
        if (!Number.isSafeInteger(lineTotal)) throw new Error("TOTAL_INVALID");
        subtotal += lineTotal;
        return { productId: item.productId, nameSnapshot: String(data.name), unitPricePaise: price, quantity: item.quantity, lineTotalPaise: lineTotal, stock };
      });
      if (!Number.isSafeInteger(subtotal) || subtotal < 1 || subtotal > 100_000_000) throw new Error("TOTAL_INVALID");
      const orderItems = nextItems.map((item) => ({
        productId: item.productId,
        nameSnapshot: item.nameSnapshot,
        unitPricePaise: item.unitPricePaise,
        quantity: item.quantity,
        lineTotalPaise: item.lineTotalPaise,
      }));
      const totalPaise = subtotal + config.shippingPaise;
      if (!Number.isSafeInteger(totalPaise) || totalPaise > 100_000_000) throw new Error("TOTAL_INVALID");
      const expiresAt = Timestamp.fromMillis(Date.now() + 30 * 60 * 1000);

      transaction.create(orderRef, {
        userId: user.uid,
        orderNumber,
        items: orderItems,
        subtotalPaise: subtotal,
        shippingPaise: config.shippingPaise,
        discountPaise: 0,
        totalPaise,
        status: "pending_payment",
        paymentStatus: "created",
        paymentMode: "test",
        // Test purchases never consume or reserve real storefront inventory.
        stockReserved: false,
        reservationExpiresAt: expiresAt,
        shippingAddress,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(checkoutRequestRef, {
        uid: user.uid,
        state: "reserved",
        orderId: orderRef.id,
        requestId: payload.requestId,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { subtotalPaise: subtotal, totalPaise, orderItems, shippingAddress };
    });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "";
    const messages: Record<string, [string, number]> = {
      CHECKOUT_REQUEST_EXISTS: ["This checkout attempt is already being processed. Refresh your bag and try again.", 409],
      ADDRESS_NOT_FOUND: ["That delivery address was not found. Refresh your saved addresses and try again.", 404],
      ADDRESS_INVALID: ["That delivery address is incomplete. Update it before checkout.", 400],
      PRODUCT_NOT_FOUND: ["A product in your bag is no longer available.", 409],
      PRODUCT_UNAVAILABLE: ["A product in your bag is no longer published for sale.", 409],
      INSUFFICIENT_STOCK: ["There is not enough stock for one or more products in your bag.", 409],
      TOTAL_INVALID: ["The order total is invalid. Please refresh your bag.", 400],
    };
    const [message, status] = messages[code] ?? ["Checkout could not be prepared. Please try again.", 500];
    return jsonError(message, status);
  }

  try {
    const totalPaise = prepared.totalPaise;
    const razorpayOrder = await razorpayRequest<RazorpayOrder>("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: totalPaise,
        currency: "INR",
        receipt: orderNumber,
        notes: { store_order_id: orderRef.id, order_number: orderNumber, payment_mode: "test" },
      }),
    });
    if (razorpayOrder.amount !== totalPaise || razorpayOrder.currency !== "INR") throw new Error("Razorpay returned an unexpected amount.");
    await db.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists || orderSnapshot.data()?.paymentStatus !== "created") throw new Error("Checkout order changed unexpectedly.");
      transaction.update(orderRef, { razorpayOrderId: razorpayOrder.id, updatedAt: FieldValue.serverTimestamp() });
      transaction.update(checkoutRequestRef, { state: "ready", razorpayOrderId: razorpayOrder.id, updatedAt: FieldValue.serverTimestamp() });
    });
    return Response.json({ orderId: orderRef.id, orderNumber, razorpayOrderId: razorpayOrder.id, amount: totalPaise, currency: "INR", keyId: config.keyId }, { status: 201 });
  } catch {
    await releaseReservation(orderRef, { status: "failed", reason: "Payment service could not create a test order." }).catch(() => undefined);
    await checkoutRequestRef.update({ state: "failed", updatedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
    return jsonError("The test payment service could not create your order. Your stock has been released; please try again.", 502);
  }
}
