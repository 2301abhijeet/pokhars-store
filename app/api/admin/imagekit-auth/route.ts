import { createHmac, randomUUID } from "node:crypto";
import { adminOrResponse, isResponse, jsonError } from "@/lib/firebase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;

  const publicKey = process.env.IMAGEKIT_PUBLIC_KEY?.trim();
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return jsonError(
      "ImageKit uploads are not configured yet. Add IMAGEKIT_PUBLIC_KEY and IMAGEKIT_PRIVATE_KEY to the Vercel project, then redeploy.",
      503,
    );
  }

  const token = randomUUID();
  const expire = Math.floor(Date.now() / 1000) + 10 * 60;
  const signature = createHmac("sha1", privateKey)
    .update(token + expire)
    .digest("hex");

  return Response.json(
    { token, expire, signature, publicKey },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
