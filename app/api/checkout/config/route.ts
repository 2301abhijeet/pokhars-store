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
    simulationEnabled: process.env.VERCEL_ENV !== "production" && process.env.CHECKOUT_SIMULATION_ENABLED === "true",
  }, { headers: { "cache-control": "no-store" } });
}
