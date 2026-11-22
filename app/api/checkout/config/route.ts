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
    demoMode: process.env.NEXT_PUBLIC_CATALOGUE_DEMO_MODE === "true",
  }, { headers: { "cache-control": "no-store" } });
}
