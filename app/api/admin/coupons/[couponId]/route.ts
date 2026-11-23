import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminOrResponse, isResponse, jsonError } from "@/lib/firebase/admin";
import { isRecord } from "@/lib/firebase/admin-validation";

export const runtime = "nodejs";
type Context = { params: Promise<{ couponId: string }> };

function valid(body: unknown) {
  if (!isRecord(body)) return false;
  if (typeof body.code !== "string" || !/^[A-Z0-9_-]{3,32}$/.test(body.code.trim().toUpperCase())) return false;
  if (body.discountType !== "percent" && body.discountType !== "fixed") return false;
  if (typeof body.discountValue !== "number" || !Number.isFinite(body.discountValue) || body.discountValue <= 0) return false;
  if ((body.discountType === "percent" && body.discountValue > 100) || (body.discountType === "fixed" && !Number.isInteger(body.discountValue))) return false;
  if (body.minOrderPaise !== undefined && (!Number.isSafeInteger(body.minOrderPaise) || Number(body.minOrderPaise) < 0)) return false;
  if (body.maxDiscountPaise !== undefined && body.maxDiscountPaise !== null && (!Number.isSafeInteger(body.maxDiscountPaise) || Number(body.maxDiscountPaise) < 1)) return false;
  if (body.usageLimit !== undefined && body.usageLimit !== null && (!Number.isSafeInteger(body.usageLimit) || Number(body.usageLimit) < 1)) return false;
  for (const field of ["startsAt", "expiresAt"] as const) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== "" &&
        (typeof body[field] !== "string" || !Number.isFinite(Date.parse(body[field] as string)))) return false;
  }
  return typeof body.isActive === "boolean";
}

export async function PATCH(request: Request, context: Context) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid JSON body.", 400); }
  if (!valid(body) || !isRecord(body)) return jsonError("Enter a code, discount type, valid discount amount and active state.", 400);
  const { couponId } = await context.params;
  const ref = adminDb().collection("coupons").doc(couponId);
  const existing = await ref.get();
  if (!existing.exists) return jsonError("Coupon not found.", 404);
  const code = (body.code as string).trim().toUpperCase();
  if (code !== couponId) return jsonError("Coupon codes cannot be renamed. Create a new code instead.", 400);
  await ref.update({
    discountType: body.discountType,
    discountValue: body.discountValue,
    isActive: body.isActive,
    minOrderPaise: Number(body.minOrderPaise ?? existing.data()?.minOrderPaise ?? 0),
    maxDiscountPaise: body.maxDiscountPaise === undefined ? (existing.data()?.maxDiscountPaise ?? null) : body.maxDiscountPaise,
    usageLimit: body.usageLimit === undefined ? (existing.data()?.usageLimit ?? null) : body.usageLimit,
    startsAt: body.startsAt === undefined ? (existing.data()?.startsAt ?? null) : body.startsAt,
    expiresAt: body.expiresAt === undefined ? (existing.data()?.expiresAt ?? null) : body.expiresAt,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: Context) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;
  const { couponId } = await context.params;
  const ref = adminDb().collection("coupons").doc(couponId);
  const existing = await ref.get();
  if (!existing.exists) return jsonError("Coupon not found.", 404);
  await ref.update({ isActive: false, updatedAt: FieldValue.serverTimestamp() });
  return Response.json({ ok: true, deactivated: true });
}
