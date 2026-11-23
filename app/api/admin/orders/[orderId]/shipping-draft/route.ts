import { adminOrResponse, isResponse, jsonError } from "@/lib/firebase/admin";
import { createShiprocketDraft } from "@/lib/shipping/shiprocket";

export const runtime = "nodejs";
type Context = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, context: Context) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;
  const { orderId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(orderId)) return jsonError("Invalid order reference.", 400);
  try {
    const result = await createShiprocketDraft(orderId);
    return Response.json({ ok: true, ...result, message: "Shiprocket custom-order draft created. Assign AWB and schedule pickup from Shiprocket when the parcel is ready." }, { status: 201 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Shiprocket draft could not be created.";
    return jsonError(message, /not configured/i.test(message) ? 503 : 409);
  }
}
