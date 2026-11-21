export const productCategories = ["Classic", "Masala", "Fresh", "Cheesy", "Premium"] as const;
export const orderStatuses = ["pending_payment", "confirmed", "processing", "shipped", "delivered", "cancelled", "refunded"] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function validateProduct(value: unknown): string | null {
  if (!isRecord(value)) return "Product details are required.";
  if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 120) return "Enter a product name up to 120 characters.";
  if (typeof value.flavour !== "string" || !value.flavour.trim() || value.flavour.length > 120) return "Enter a flavour up to 120 characters.";
  if (!productCategories.includes(value.category as (typeof productCategories)[number])) return "Choose a valid category.";
  if (typeof value.pricePaise !== "number" || !Number.isInteger(value.pricePaise) || value.pricePaise < 1) return "Price must be a positive amount in paise.";
  if (typeof value.netWeightGrams !== "number" || !Number.isInteger(value.netWeightGrams) || value.netWeightGrams < 1) return "Weight must be a positive number of grams.";
  if (typeof value.stockQuantity !== "number" || !Number.isInteger(value.stockQuantity) || value.stockQuantity < 0) return "Stock must be zero or more.";
  if (typeof value.imageUrl !== "string" || (value.imageUrl && !/^https:\/\//i.test(value.imageUrl))) return "Use an HTTPS image URL or leave it blank.";
  if (typeof value.isActive !== "boolean" || !["draft", "published"].includes(String(value.visibility))) return "Choose an active state and publication status.";
  if (typeof value.description !== "string" || value.description.length > 2000) return "Description must be under 2,000 characters.";
  return null;
}

export function toSlug(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}
