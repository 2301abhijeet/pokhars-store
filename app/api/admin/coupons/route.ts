import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminOrResponse, isResponse, jsonError } from "@/lib/firebase/admin";
import { isRecord } from "@/lib/firebase/admin-validation";

export const runtime = "nodejs";

function validateCoupon(body: unknown): string | null {
  if (!isRecord(body)) return "Coupon details are required.";
  if (typeof body.code !== "string" || !/^[A-Z0-9_-]{3,32}$/.test(body.code.trim().toUpperCase())) return "Use a 3–32 character code with letters, numbers, _ or -.";
  if (body.discountType !== "percent" && body.discountType !== "fixed") return "Choose a percentage or fixed discount.";
  if (typeof body.discountValue !== "number" || !Number.isFinite(body.discountValue) || body.discountValue <= 0) return "Discount must be greater than zero.";
  if ((body.discountType === "percent" && body.discountValue > 100) || (body.discountType === "fixed" && !Number.isInteger(body.discountValue))) return "Enter a valid discount amount.";
  if (typeof body.isActive !== "boolean") return "Choose whether the coupon is active.";
  return null;
}

export async function GET(request: Request) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;
  const snapshot = await adminDb().collection("coupons").get();
  return Response.json(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
}

export async function POST(request: Request) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid JSON body.", 400); }
  const problem = validateCoupon(body);
  if (problem) return jsonError(problem, 400);
  if (!isRecord(body)) return jsonError("Coupon details are required.", 400);
  const code = (body.code as string).trim().toUpperCase();
  const ref = adminDb().collection("coupons").doc(code);
  const existing = await ref.get();
  if (existing.exists) return jsonError("A coupon with this code already exists.", 409);
  await ref.set({
    code,
    discountType: body.discountType,
    discountValue: body.discountValue,
    isActive: body.isActive,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: code }, { status: 201 });
}
