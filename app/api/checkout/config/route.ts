import { checkoutConfig } from "@/lib/firebase/razorpay";

export const runtime = "nodejs";

export async function GET() {
  const config = checkoutConfig();
  return Response.json({
    enabled: config.enabled,
    mode: config.mode,
    keyId: config.keyId,
    shippingPaise: config.shippingPaise,
    livePaymentsEnabled: false,
  }, { headers: { "cache-control": "no-store" } });
}
