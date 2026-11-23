import "server-only";
import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";

type ShiprocketOrderResponse = { order_id?: string | number; shipment_id?: string | number; status?: string; message?: string };

function envV2(name: string) { return (process.env[name] ?? "").trim(); }

export function shiprocketSetup() {
  const required = [
    "SHIPROCKET_API_EMAIL", "SHIPROCKET_API_PASSWORD", "SHIPROCKET_PICKUP_LOCATION",
    "SHIPROCKET_PACKAGE_LENGTH_CM", "SHIPROCKET_PACKAGE_BREADTH_CM", "SHIPROCKET_PACKAGE_HEIGHT_CM",
    "SHIPROCKET_PACKAGING_WEIGHT_GRAMS", "SHIPROCKET_WEBHOOK_TOKEN",
  ];
  const missing = required.filter((key) => !envV2(key));
  const dimsOk = [
    ["SHIPROCKET_PACKAGE_LENGTH_CM", true],
    ["SHIPROCKET_PACKAGE_BREADTH_CM", true],
    ["SHIPROCKET_PACKAGE_HEIGHT_CM", true],
    ["SHIPROCKET_PACKAGING_WEIGHT_GRAMS", false],
  ].every(([key, positive]) => {
    const value = Number(envV2(String(key)));
    return Number.isFinite(value) && (positive ? value > 0 : value >= 0);
  });
  if (!dimsOk) missing.push("verified package dimensions and packaging weight");
  return { configured: missing.length === 0, missing: [...new Set(missing)] };
}

async function tokenV2(): Promise<string> {
  const email = envV2("SHIPROCKET_API_EMAIL");
  const password = envV2("SHIPROCKET_API_PASSWORD");
  if (!email || !password) throw new Error("Shiprocket API user credentials are not configured.");
  const db = adminDb();
  const tokenRef = db.collection("settings").doc("shiprocketAuth");
  const cached = await tokenRef.get();
  const current = cached.data() ?? {};
  if (typeof current.token === "string" && Number(current.expiresAtMs) > Date.now() + 60_000) return current.token;

  const response = await fetch("https://apiv2.shiprocket.in/v1/external/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as { token?: string; message?: string };
  if (!response.ok || !data.token) throw new Error(data.message || "Shiprocket API authentication failed.");
  await tokenRef.set({
    token: data.token,
    expiresAtMs: Date.now() + 9 * 24 * 60 * 60 * 1000,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return data.token;
}

export type ShiprocketServiceabilityQuote = {
  configured: true;
  serviceable: boolean;
  source: "shiprocket";
  message: string;
  courierName?: string;
  courierCompanyId?: number;
  shippingFeePaise?: number;
  deliveryMinDays?: number;
  deliveryMaxDays?: number;
};

export function shiprocketServiceabilitySetup() {
  const required = [
    "SHIPROCKET_API_EMAIL",
    "SHIPROCKET_API_PASSWORD",
    "SHIPROCKET_PICKUP_POSTCODE",
    "SHIPROCKET_PACKAGE_LENGTH_CM",
    "SHIPROCKET_PACKAGE_BREADTH_CM",
    "SHIPROCKET_PACKAGE_HEIGHT_CM",
    "SHIPROCKET_PACKAGING_WEIGHT_GRAMS",
  ];
  const missing = required.filter((key) => !envV2(key));
  const positiveKeys = [
    "SHIPROCKET_PICKUP_POSTCODE",
    "SHIPROCKET_PACKAGE_LENGTH_CM",
    "SHIPROCKET_PACKAGE_BREADTH_CM",
    "SHIPROCKET_PACKAGE_HEIGHT_CM",
  ];
  for (const key of positiveKeys) {
    const value = Number(envV2(key));
    if (!Number.isSafeInteger(value) || value <= 0) missing.push("valid " + key);
  }
  const packageWeight = Number(envV2("SHIPROCKET_PACKAGING_WEIGHT_GRAMS"));
  if (!Number.isFinite(packageWeight) || packageWeight < 0) missing.push("valid SHIPROCKET_PACKAGING_WEIGHT_GRAMS");
  return { configured: missing.length === 0, missing: [...new Set(missing)] };
}

export async function getShiprocketServiceabilityQuote(input: {
  deliveryPostcode: string;
  itemWeightGrams: number;
  declaredValuePaise: number;
}): Promise<ShiprocketServiceabilityQuote | null> {
  const setup = shiprocketServiceabilitySetup();
  if (!setup.configured) return null;
  if (!/^[1-9][0-9]{5}$/.test(input.deliveryPostcode) ||
      !Number.isSafeInteger(input.itemWeightGrams) || input.itemWeightGrams <= 0 ||
      !Number.isSafeInteger(input.declaredValuePaise) || input.declaredValuePaise < 0) {
    throw new Error("A valid destination PIN, parcel weight and declared value are required for a Shiprocket quote.");
  }

  const packagingWeight = Number(envV2("SHIPROCKET_PACKAGING_WEIGHT_GRAMS"));
  const grossWeightKg = Number(((input.itemWeightGrams + packagingWeight) / 1000).toFixed(3));
  const length = Number(envV2("SHIPROCKET_PACKAGE_LENGTH_CM"));
  const breadth = Number(envV2("SHIPROCKET_PACKAGE_BREADTH_CM"));
  const height = Number(envV2("SHIPROCKET_PACKAGE_HEIGHT_CM"));
  if (!(grossWeightKg > 0)) throw new Error("Shiprocket parcel weight must be greater than zero.");

  const token = await tokenV2();
  const query = new URLSearchParams({
    pickup_postcode: envV2("SHIPROCKET_PICKUP_POSTCODE"),
    delivery_postcode: input.deliveryPostcode,
    cod: "0",
    weight: String(grossWeightKg),
    length: String(length),
    breadth: String(breadth),
    height: String(height),
    declared_value: String(Math.round(input.declaredValuePaise / 100)),
  });
  const response = await fetch("https://apiv2.shiprocket.in/v1/external/courier/serviceability/?" + query.toString(), {
    method: "GET",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as {
    message?: string;
    data?: {
      available_courier_companies?: Array<{
        courier_name?: string;
        courier_company_id?: number;
        rate?: number | string;
        freight_charge?: number | string;
        estimated_delivery_days?: number | string;
        rating?: number | string;
        blocked?: number | boolean;
      }>;
      recommended_courier_company_id?: number;
      shiprocket_recommended_courier_id?: number;
    };
  };
  if (!response.ok) throw new Error(payload.message || "Shiprocket could not check courier serviceability.");
  const couriers = Array.isArray(payload.data?.available_courier_companies)
    ? payload.data!.available_courier_companies!.filter((courier) => courier.blocked !== 1 && courier.blocked !== true)
    : [];
  if (!couriers.length) {
    return {
      configured: true,
      serviceable: false,
      source: "shiprocket",
      message: "Shiprocket has no available courier service for this PIN code and parcel.",
    };
  }

  const recommendedId = Number(payload.data?.recommended_courier_company_id ?? payload.data?.shiprocket_recommended_courier_id ?? 0);
  const recommended = couriers.find((courier) => Number(courier.courier_company_id) === recommendedId);
  const withRates = couriers.map((courier) => ({
    courier,
    rate: Number(courier.rate ?? courier.freight_charge),
  })).filter((entry) => Number.isFinite(entry.rate) && entry.rate >= 0);
  const selected = recommended && Number.isFinite(Number(recommended.rate ?? recommended.freight_charge))
    ? { courier: recommended, rate: Number(recommended.rate ?? recommended.freight_charge) }
    : withRates.sort((a, b) => a.rate - b.rate)[0];
  if (!selected) {
    return {
      configured: true,
      serviceable: false,
      source: "shiprocket",
      message: "Shiprocket returned courier options without a usable rate. Please contact the store.",
    };
  }
  const daysValue = Number(selected.courier.estimated_delivery_days);
  const deliveryDays = Number.isFinite(daysValue) && daysValue > 0 ? Math.ceil(daysValue) : null;
  return {
    configured: true,
    serviceable: true,
    source: "shiprocket",
    courierName: String(selected.courier.courier_name ?? "Shiprocket courier"),
    courierCompanyId: Number(selected.courier.courier_company_id) || undefined,
    shippingFeePaise: Math.round(selected.rate * 100),
    ...(deliveryDays ? { deliveryMinDays: deliveryDays, deliveryMaxDays: deliveryDays } : {}),
    message: "Live courier availability and rate returned by Shiprocket.",
  };
}

export async function createShiprocketDraft(orderId: string) {
  const db = adminDb();
  const orderRef = db.collection("orders").doc(orderId);
  const snapshot = await orderRef.get();
  if (!snapshot.exists) throw new Error("Order not found.");
  const order = snapshot.data()!;
  if (order.paymentMode !== "live" || order.paymentStatus !== "paid" || order.demoOrder === true) {
    throw new Error("Only captured live orders can be sent to Shiprocket. Test and demo orders are blocked.");
  }
  if (!["confirmed", "processing"].includes(String(order.status))) throw new Error("Only confirmed or processing orders can create a courier draft.");
  if (order.inventoryIssue) throw new Error("Resolve the inventory issue before creating a courier draft.");
  if (order.shiprocketOrderId || ["creating", "needs_review"].includes(String(order.shiprocketDraftState))) {
    throw new Error("A Shiprocket draft already exists or needs manual reconciliation.");
  }
  const setup = shiprocketSetup();
  if (!setup.configured) throw new Error("Shiprocket is not configured. Missing: " + setup.missing.join(", "));

  const address = order.shippingAddress;
  if (!address || typeof address !== "object" || Array.isArray(address)) throw new Error("Order has no saved shipping address.");
  const recipient = String(address.recipientName ?? "").trim();
  const phone = String(address.phone ?? "").replace(/\D/g, "").slice(-10);
  const line1 = String(address.line1 ?? "").trim();
  const city = String(address.city ?? "").trim();
  const state = String(address.state ?? "").trim();
  const pincode = String(address.pincode ?? "").trim();
  const email = String(order.customerEmail ?? "").trim();
  if (!recipient || phone.length !== 10 || !line1 || !city || !state || !/^[1-9][0-9]{5}$/.test(pincode) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Customer address or email is incomplete for courier creation.");
  }
  const items = Array.isArray(order.items) ? order.items as Array<Record<string, unknown>> : [];
  if (!items.length) throw new Error("Order has no item snapshots.");
  const courierItems = items.map((item) => {
    const weight = Number(item.netWeightGrams);
    const quantity = Number(item.quantity);
    const price = Number(item.unitPricePaise);
    if (!Number.isSafeInteger(weight) || weight < 1 || !Number.isSafeInteger(quantity) || quantity < 1 ||
        !Number.isSafeInteger(price) || price < 1) throw new Error("Order item is missing verified SKU, weight or price.");
    return {
      name: String(item.nameSnapshot ?? "POKHAR'S product").slice(0, 120),
      sku: String(item.sku ?? item.productId ?? "POKHARS").slice(0, 50),
      units: quantity,
      selling_price: price / 100,
    };
  });
  const itemWeightGrams = items.reduce((sum, item) => sum + Number(item.netWeightGrams) * Number(item.quantity), 0);
  const packageWeight = Number(envV2("SHIPROCKET_PACKAGING_WEIGHT_GRAMS"));
  const length = Number(envV2("SHIPROCKET_PACKAGE_LENGTH_CM"));
  const breadth = Number(envV2("SHIPROCKET_PACKAGE_BREADTH_CM"));
  const height = Number(envV2("SHIPROCKET_PACKAGE_HEIGHT_CM"));
  const weight = Number(((itemWeightGrams + packageWeight) / 1000).toFixed(3));
  if (!(weight > 0) || !(length > 0) || !(breadth > 0) || !(height > 0)) throw new Error("Enter verified package dimensions and weight in Vercel.");

  const orderNumber = String(order.orderNumber ?? orderId);
  const shiprocketOrderNumber = orderNumber.length <= 20 ? orderNumber : "PK" + orderId.slice(-18).toUpperCase();
  const requestId = randomUUID();
  await db.runTransaction(async (transaction) => {
    const latest = await transaction.get(orderRef);
    if (!latest.exists) throw new Error("Order not found.");
    const current = latest.data()!;
    if (current.shiprocketOrderId || ["creating", "needs_review"].includes(String(current.shiprocketDraftState))) {
      throw new Error("A Shiprocket draft already exists or needs manual reconciliation.");
    }
    transaction.update(orderRef, {
      shiprocketDraftState: "creating",
      shiprocketDraftRequestId: requestId,
      shiprocketDraftRequestedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  try {
    const apiToken = await tokenV2();
    const createdDate = order.createdAt && typeof order.createdAt.toDate === "function" ? order.createdAt.toDate() as Date : new Date();
    const payload = {
      order_id: shiprocketOrderNumber,
      order_date: createdDate.toISOString().slice(0, 16).replace("T", " "),
      pickup_location: envV2("SHIPROCKET_PICKUP_LOCATION"),
      comment: "POKHAR'S order " + orderNumber,
      billing_customer_name: recipient.split(/\s+/)[0] ?? recipient,
      billing_last_name: recipient.split(/\s+/).slice(1).join(" "),
      billing_address: line1.slice(0, 190),
      billing_address_2: String(address.line2 ?? address.landmark ?? "").slice(0, 190),
      billing_isd_code: "91",
      billing_city: city,
      billing_pincode: pincode,
      billing_state: state,
      billing_country: "India",
      billing_email: email,
      billing_phone: phone,
      shipping_is_billing: true,
      order_items: courierItems,
      payment_method: "Prepaid",
      shipping_charges: Number(order.shippingPaise ?? 0) / 100,
      total_discount: Number(order.discountPaise ?? 0) / 100,
      sub_total: Number(order.subtotalPaise ?? 0) / 100,
      length, breadth, height, weight,
    };
    const response = await fetch("https://apiv2.shiprocket.in/v1/external/orders/create/adhoc", {
      method: "POST",
      headers: { authorization: "Bearer " + apiToken, "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({})) as ShiprocketOrderResponse;
    if (!response.ok || result.order_id == null || result.shipment_id == null) {
      throw new Error(result.message || "Shiprocket did not confirm the courier draft.");
    }
    await db.runTransaction(async (transaction) => {
      const latest = await transaction.get(orderRef);
      if (!latest.exists || latest.data()?.shiprocketDraftRequestId !== requestId) {
        throw new Error("Order changed during courier creation. Check Shiprocket before retrying.");
      }
      transaction.update(orderRef, {
        shiprocketOrderId: String(result.order_id),
        shiprocketShipmentId: String(result.shipment_id),
        shiprocketStatus: String(result.status ?? "NEW"),
        shiprocketDraftState: "created",
        statusHistory: FieldValue.arrayUnion({
          status: String(order.status),
          event: "courier_draft_created",
          note: "Shiprocket custom-order draft created. No AWB, pickup or dispatch has been requested.",
          occurredAt: new Date().toISOString(),
        }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { orderId: String(result.order_id), shipmentId: String(result.shipment_id), status: String(result.status ?? "NEW") };
  } catch (cause) {
    await orderRef.update({
      shiprocketDraftState: "needs_review",
      shiprocketDraftError: cause instanceof Error ? cause.message : "Unknown Shiprocket response.",
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined);
    throw new Error(cause instanceof Error ? cause.message : "Shiprocket draft result is uncertain. Reconcile in Shiprocket before retrying.");
  }
}
