import { adminOrResponse, isResponse } from "@/lib/firebase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;
  return Response.json({ uid: access.uid, email: access.email ?? null });
}
