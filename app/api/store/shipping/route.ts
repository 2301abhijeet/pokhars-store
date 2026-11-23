import { jsonError } from "@/lib/firebase/admin";
import { getShippingSettings, quoteShipping } from "@/lib/firebase/shipping";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const settings = await getShippingSettings();
    const url = new URL(request.url);
    const pincode = url.searchParams.get("pincode");
    if (!pincode) {
      return Response.json({
        configured: settings.enabled && settings.zones.length > 0,
        policyNote: settings.policyNote,
        handlingMinDays: settings.handlingMinDays,
        handlingMaxDays: settings.handlingMaxDays,
        message: settings.enabled
          ? "Enter your PIN code to check delivery availability and charges."
          : "Delivery information is being configured.",
      }, { headers: { "cache-control": "no-store" } });
    }
    if (!/^[1-9][0-9]{5}$/.test(pincode)) return jsonError("Enter a valid 6-digit Indian PIN code.", 400);
    const subtotal = Number(url.searchParams.get("subtotalPaise") ?? 0);
    if (!Number.isSafeInteger(subtotal) || subtotal < 0 || subtotal > 100_000_000) return jsonError("Invalid cart subtotal.", 400);
    const quote = quoteShipping(settings, pincode, subtotal);
    return Response.json(quote, { headers: { "cache-control": "no-store" } });
  } catch {
    return jsonError("Delivery availability could not be checked right now.", 503);
  }
}
