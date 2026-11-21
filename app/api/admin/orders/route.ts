import { adminDb, adminOrResponse, isResponse } from "@/lib/firebase/admin";
import { releaseExpiredReservations } from "@/lib/firebase/razorpay";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;
  await releaseExpiredReservations().catch(() => undefined);
  const snapshot = await adminDb().collection("orders").orderBy("createdAt", "desc").limit(200).get();
  return Response.json(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
}
