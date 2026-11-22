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
  const optionalTextLimits: Record<string, number> = { sku: 40, ingredients: 3000, allergenInfo: 1200, nutritionInfo: 2000, storageInstructions: 500, shelfLife: 120, manufacturerName: 180, manufacturerAddress: 500, fssaiLicenseNumber: 30, countryOfOrigin: 80 };
  for (const [field, limit] of Object.entries(optionalTextLimits)) {
    if (value[field] !== undefined && typeof value[field] !== "string") return `${field} must be text.`;
    if (typeof value[field] === "string" && (value[field] as string).length > limit) return `${field} must be ${limit} characters or fewer.`;
  }
  if (typeof value.sku === "string" && value.sku && !/^[A-Z0-9_-]{1,40}$/.test(value.sku)) return "Use letters, numbers, dashes or underscores for the SKU.";
  if (value.mrpPaise !== undefined && value.mrpPaise !== null && (typeof value.mrpPaise !== "number" || !Number.isInteger(value.mrpPaise) || value.mrpPaise < value.pricePaise)) return "MRP must be a whole number of paise and cannot be lower than the selling price.";
  if (value.isActive === true && value.visibility === "published") {
    const requiredForPublication: Array<[string, string]> = [
      ["imageUrl", "Add the final product pack photo before publishing."],
      ["ingredients", "Add the approved ingredient statement before publishing."],
      ["allergenInfo", "Add the verified allergen declaration before publishing."],
      ["nutritionInfo", "Add verified nutrition information before publishing."],
      ["manufacturerName", "Add the manufacturer or packer name before publishing."],
      ["manufacturerAddress", "Add the manufacturer or packer address before publishing."],
      ["fssaiLicenseNumber", "Add the FSSAI licence number before publishing."],
    ];
    for (const [field, message] of requiredForPublication) if (typeof value[field] !== "string" || !(value[field] as string).trim()) return message;
  }
  return null;
}

export function toSlug(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}
