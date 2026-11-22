import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminOrResponse, isResponse, jsonError } from "@/lib/firebase/admin";
import { isRecord, toSlug, validateProduct } from "@/lib/firebase/admin-validation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;
  const snapshot = await adminDb().collection("products").get();
  return Response.json(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
}

export async function POST(request: Request) {
  const access = await adminOrResponse(request);
  if (isResponse(access)) return access;
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("Invalid JSON body.", 400); }
  const problem = validateProduct(body);
  if (problem) return jsonError(problem, 400);
  if (!isRecord(body)) return jsonError("Product details are required.", 400);
  const product = body as {
    name: string; description: string; flavour: string; category: string; imageUrl: string;
    sku?: string; mrpPaise?: number | null; ingredients?: string; allergenInfo?: string;
    nutritionInfo?: string; storageInstructions?: string; shelfLife?: string;
    manufacturerName?: string; manufacturerAddress?: string; fssaiLicenseNumber?: string;
    countryOfOrigin?: string; packImageVerified?: boolean; pricePaise: number; netWeightGrams: number; stockQuantity: number;
    isActive: boolean; visibility: "draft" | "published"; sortOrder?: number
  };

  const ref = adminDb().collection("products").doc();
  await ref.set({
    name: product.name.trim(),
    slug: toSlug(product.name),
    description: product.description,
    flavour: product.flavour.trim(),
    category: product.category,
    imageUrl: product.imageUrl.trim(),
    sku: (product.sku ?? "").trim().toUpperCase(),
    mrpPaise: Number.isInteger(product.mrpPaise) && Number(product.mrpPaise) > 0 ? product.mrpPaise : null,
    ingredients: (product.ingredients ?? "").trim(),
    allergenInfo: (product.allergenInfo ?? "").trim(),
    nutritionInfo: (product.nutritionInfo ?? "").trim(),
    storageInstructions: (product.storageInstructions ?? "").trim(),
    shelfLife: (product.shelfLife ?? "").trim(),
    manufacturerName: (product.manufacturerName ?? "").trim(),
    manufacturerAddress: (product.manufacturerAddress ?? "").trim(),
    fssaiLicenseNumber: (product.fssaiLicenseNumber ?? "").trim(),
    countryOfOrigin: (product.countryOfOrigin ?? "India").trim(),
    packImageVerified: product.packImageVerified === true,
    pricePaise: product.pricePaise,
    netWeightGrams: product.netWeightGrams,
    stockQuantity: product.stockQuantity,
    isActive: product.isActive,
    visibility: product.visibility,
    sortOrder: Number.isInteger(product.sortOrder) ? product.sortOrder : 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return Response.json({ id: ref.id }, { status: 201 });
}
