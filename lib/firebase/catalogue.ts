import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";
import type { Product } from "@/lib/products";
import { isPlaceholderProductValue, isValidFssaiNumber } from "@/lib/firebase/admin-validation";

type ProductCategory = Product["category"];

const isDemoCatalogueMode = process.env.NEXT_PUBLIC_CATALOGUE_DEMO_MODE === "true";

const categoryDefaults: Record<ProductCategory, { accent: string; ink: string; symbol: string; mood: string }> = {
  Classic: { accent: "#0b694f", ink: "#07543f", symbol: "✳", mood: "CLASSIC" },
  Masala: { accent: "#a92725", ink: "#85201f", symbol: "✺", mood: "MASALA" },
  Fresh: { accent: "#2e7955", ink: "#1d6041", symbol: "❋", mood: "MINTY" },
  Cheesy: { accent: "#e4b52c", ink: "#946b13", symbol: "✷", mood: "CHEESY" },
  Premium: { accent: "#e98cab", ink: "#a54d70", symbol: "✿", mood: "PREMIUM" },
};

function asCategory(value: unknown): ProductCategory {
  if (
    value === "Classic" ||
    value === "Masala" ||
    value === "Fresh" ||
    value === "Cheesy" ||
    value === "Premium"
  ) return value;
  return "Classic";
}

function mapProduct(id: string, data: Record<string, unknown>): Product | null {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const pricePaise = Number(data.pricePaise);
  const grams = Number(data.netWeightGrams);
  const publishTextFields = ["imageUrl", "ingredients", "allergenInfo", "nutritionInfo", "manufacturerName", "manufacturerAddress"];
  const hasVerifiedPublishDetails = isDemoCatalogueMode || (
    publishTextFields.every((field) => !isPlaceholderProductValue(data[field]))
      && data.packImageVerified === true
      && isValidFssaiNumber(data.fssaiLicenseNumber)
  );

  // Ignore malformed or incomplete product documents rather than showing
  // an empty title, NaN price, or invalid pack size to shoppers.
  if (!name || !Number.isFinite(pricePaise) || pricePaise <= 0 || !Number.isFinite(grams) || grams <= 0 || !hasVerifiedPublishDetails) {
    return null;
  }

  const category = asCategory(data.category);
  const defaults = categoryDefaults[category];
  const description = typeof data.description === "string" ? data.description : "";
  const flavour = typeof data.flavour === "string" && data.flavour.trim()
    ? data.flavour.trim()
    : name;

  return {
    id,
    isDemo: isDemoCatalogueMode,
    name,
    flavour,
    category,
    price: Math.round(pricePaise) / 100,
    weight: `${grams} g`,
    note: description,
    accent: typeof data.accent === "string" ? data.accent : defaults.accent,
    ink: typeof data.ink === "string" ? data.ink : defaults.ink,
    symbol: typeof data.symbol === "string" ? data.symbol : defaults.symbol,
    mood: typeof data.mood === "string" ? data.mood : defaults.mood,
    tagline: typeof data.tagline === "string" && data.tagline.trim()
      ? data.tagline
      : flavour,
    slug: typeof data.slug === "string" && data.slug.trim() ? data.slug.trim() : id,
    ...(typeof data.sku === "string" && data.sku.trim() ? { sku: data.sku.trim() } : {}),
    ...(typeof data.ingredients === "string" && data.ingredients.trim() ? { ingredients: data.ingredients.trim() } : {}),
    ...(typeof data.allergenInfo === "string" && data.allergenInfo.trim() ? { allergenInfo: data.allergenInfo.trim() } : {}),
    ...(typeof data.nutritionInfo === "string" && data.nutritionInfo.trim() ? { nutritionInfo: data.nutritionInfo.trim() } : {}),
    ...(typeof data.storageInstructions === "string" && data.storageInstructions.trim() ? { storageInstructions: data.storageInstructions.trim() } : {}),
    ...(typeof data.shelfLife === "string" && data.shelfLife.trim() ? { shelfLife: data.shelfLife.trim() } : {}),
    ...(typeof data.manufacturerName === "string" && data.manufacturerName.trim() ? { manufacturerName: data.manufacturerName.trim() } : {}),
    ...(typeof data.manufacturerAddress === "string" && data.manufacturerAddress.trim() ? { manufacturerAddress: data.manufacturerAddress.trim() } : {}),
    ...(typeof data.fssaiLicenseNumber === "string" && data.fssaiLicenseNumber.trim() ? { fssaiLicenseNumber: data.fssaiLicenseNumber.trim() } : {}),
    ...(typeof data.countryOfOrigin === "string" && data.countryOfOrigin.trim() ? { countryOfOrigin: data.countryOfOrigin.trim() } : {}),
    ...(typeof data.tag === "string" && data.tag.trim() ? { tag: data.tag } : {}),
    ...(typeof data.imageUrl === "string" && data.imageUrl.trim() ? { imageUrl: data.imageUrl } : {}),
    ...(Number.isInteger(data.mrpPaise) && Number(data.mrpPaise) > pricePaise ? { mrp: Number(data.mrpPaise) / 100 } : {}),
  };
}

/**
 * Subscribe to active, published products only. The Firestore security rules
 * require both filters; the composite index is tracked in firestore.indexes.json.
 */
export function subscribeToPublishedProducts(
  onProducts: (products: Product[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase Firestore is not configured.");

  const publishedQuery = query(
    collection(db, "products"),
    where("isActive", "==", true),
    where("visibility", "==", "published"),
  );

  return onSnapshot(
    publishedQuery,
    (snapshot) => {
      const liveProducts = snapshot.docs
        .map((item) => mapProduct(item.id, item.data()))
        .filter((item): item is Product => item !== null)
        .sort((a, b) => {
          const aOrder = Number(snapshot.docs.find((doc) => doc.id === a.id)?.data().sortOrder ?? 0);
          const bOrder = Number(snapshot.docs.find((doc) => doc.id === b.id)?.data().sortOrder ?? 0);
          return aOrder - bOrder;
        });

      onProducts(liveProducts);
    },
    (cause) => onError(cause),
  );
}
