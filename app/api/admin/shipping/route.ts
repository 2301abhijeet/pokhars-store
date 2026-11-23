import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminOrResponse, isRecord, isResponse, jsonError } from "@/lib/firebase/admin";
import { emptyShippingSettings, validateShippingSettings } from "@/lib/firebase/shipping";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;
  try {
    const snapshot = await adminDb().collection("settings").doc("shipping").get();
    const data = snapshot.exists ? snapshot.data() ?? {} : emptyShippingSettings;
    return Response.json({
      settings: {
        enabled: data.enabled === true,
        policyNote: typeof data.policyNote === "string" ? data.policyNote : "",
        handlingMinDays: Number(data.handlingMinDays ?? 0),
        handlingMaxDays: Number(data.handlingMaxDays ?? 0),
        zones: Array.isArray(data.zones) ? data.zones : [],
      },
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return jsonError("Shipping settings could not be loaded.", 503);
  }
}

export async function PUT(request: Request) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid JSON body.", 400); }
  if (!isRecord(body)) return jsonError("Invalid shipping settings.", 400);
  const result = validateShippingSettings(body);
  if (!result.settings) return jsonError(result.error ?? "Shipping settings are invalid.", 400);
  try {
    await adminDb().collection("settings").doc("shipping").set({
      ...result.settings,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: access.uid,
    });
    return Response.json({ ok: true, settings: result.settings });
  } catch {
    return jsonError("Shipping settings could not be saved.", 503);
  }
}
