import "server-only";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";

function getAdminApp() {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson) as {
      project_id?: string;
      client_email: string;
      private_key: string;
    };
    return initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id ?? projectId,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key.replace(/\\n/g, "\n"),
      }),
      projectId: projectId ?? serviceAccount.project_id,
    });
  }

  // ADC is supported for local development and managed Google environments.
  return initializeApp(projectId ? { projectId } : undefined);
}

function configuredAdmin(decoded: DecodedIdToken): boolean {
  if (decoded.admin === true) return true;

  const allowedUids = (process.env.ADMIN_UIDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowedUids.includes(decoded.uid)) return true;

  const allowedEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return decoded.email_verified === true &&
    typeof decoded.email === "string" &&
    allowedEmails.includes(decoded.email.toLowerCase());
}

export async function requireAdmin(request: Request): Promise<DecodedIdToken | null> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  try {
    const app = getAdminApp();
    const decoded = await getAuth(app).verifyIdToken(token, true);
    return configuredAdmin(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function adminDb() {
  return getFirestore(getAdminApp());
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function adminOrResponse(request: Request) {
  try {
    const admin = await requireAdmin(request);
    return admin ?? jsonError("Admin access required.", 403);
  } catch {
    return jsonError("Admin service is not configured.", 503);
  }
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}
