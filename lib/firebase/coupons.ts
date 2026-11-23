import "server-only";

export type CouponEvaluation =
  | { valid: true; discountPaise: number; code: string }
  | { valid: false; message: string };

function dateMillis(value: unknown): number | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    try { return (value as { toDate: () => Date }).toDate().getTime(); } catch { return null; }
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export function evaluateCoupon(coupon: Record<string, unknown>, subtotalPaise: number, now = Date.now()): CouponEvaluation {
  const code = typeof coupon.code === "string" ? coupon.code : "";
  if (coupon.isActive !== true) return { valid: false, message: "This coupon is not active." };
  if (!Number.isSafeInteger(subtotalPaise) || subtotalPaise < 1) return { valid: false, message: "Add products before applying a coupon." };

  const startsAt = coupon.startsAt ? dateMillis(coupon.startsAt) : null;
  const expiresAt = coupon.expiresAt ? dateMillis(coupon.expiresAt) : null;
  if (coupon.startsAt && startsAt === null) return { valid: false, message: "This coupon has an invalid start date." };
  if (coupon.expiresAt && expiresAt === null) return { valid: false, message: "This coupon has an invalid expiry date." };
  if (startsAt !== null && now < startsAt) return { valid: false, message: "This coupon is not active yet." };
  if (expiresAt !== null && now > expiresAt) return { valid: false, message: "This coupon has expired." };

  const minOrderPaise = Number(coupon.minOrderPaise ?? 0);
  if (!Number.isSafeInteger(minOrderPaise) || minOrderPaise < 0) return { valid: false, message: "This coupon has an invalid minimum order." };
  if (subtotalPaise < minOrderPaise) return { valid: false, message: "Your bag does not meet this coupon's minimum order value." };

  const usageLimit = coupon.usageLimit == null ? 0 : Number(coupon.usageLimit);
  const usedCount = Math.max(0, Number(coupon.usedCount ?? 0));
  const reservedCount = Math.max(0, Number(coupon.reservedCount ?? 0));
  if (usageLimit > 0 && Number.isSafeInteger(usageLimit) && usedCount + reservedCount >= usageLimit) {
    return { valid: false, message: "This coupon has reached its usage limit." };
  }

  const discountType = coupon.discountType;
  const discountValue = Number(coupon.discountValue);
  if (!Number.isFinite(discountValue) || discountValue <= 0) return { valid: false, message: "This coupon has an invalid discount." };
  let discountPaise = 0;
  if (discountType === "percent") {
    if (discountValue > 100) return { valid: false, message: "This coupon has an invalid percentage." };
    discountPaise = Math.floor(subtotalPaise * discountValue / 100);
  } else if (discountType === "fixed") {
    discountPaise = Math.floor(discountValue);
  } else {
    return { valid: false, message: "This coupon has an unsupported discount type." };
  }
  const maxDiscountPaise = coupon.maxDiscountPaise == null ? 0 : Number(coupon.maxDiscountPaise);
  if (maxDiscountPaise > 0 && Number.isSafeInteger(maxDiscountPaise)) discountPaise = Math.min(discountPaise, maxDiscountPaise);
  discountPaise = Math.max(0, Math.min(discountPaise, subtotalPaise));
  if (discountPaise < 1) return { valid: false, message: "This coupon does not apply to this bag." };
  return { valid: true, discountPaise, code };
}
