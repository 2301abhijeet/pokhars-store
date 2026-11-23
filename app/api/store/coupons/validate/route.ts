import { adminDb, jsonError, verifySignedInUser } from "@/lib/firebase/admin";
import { evaluateCoupon } from "@/lib/firebase/coupons";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await verifySignedInUser(request);
  if (!user) return jsonError("Sign in before applying a coupon.", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid coupon request.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError("Invalid coupon request.", 400);
  const payload = body as { code?: unknown; subtotalPaise?: unknown };
  if (typeof payload.code !== "string" || !/^[A-Z0-9_-]{3,32}$/i.test(payload.code.trim())) return jsonError("Enter a valid coupon code.", 400);
  if (!Number.isSafeInteger(payload.subtotalPaise) || Number(payload.subtotalPaise) < 1 || Number(payload.subtotalPaise) > 100_000_000) {
    return jsonError("Your bag total is invalid.", 400);
  }
  try {
    const code = payload.code.trim().toUpperCase();
    const snapshot = await adminDb().collection("coupons").doc(code).get();
    if (!snapshot.exists) return jsonError("This coupon code was not found.", 404);
    const result = evaluateCoupon(snapshot.data() ?? {}, Number(payload.subtotalPaise));
    if (!result.valid) return jsonError(result.message, 409);
    return Response.json({ code: result.code, discountPaise: result.discountPaise }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return jsonError("Coupon validation is temporarily unavailable.", 503);
  }
}
