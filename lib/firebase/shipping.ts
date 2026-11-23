import "server-only";

import { adminDb } from "@/lib/firebase/admin";

export type ShippingZone = {
  id: string;
  name: string;
  pincodes: string[];
  shippingFeePaise: number;
  freeShippingAbovePaise: number | null;
  deliveryMinDays: number;
  deliveryMaxDays: number;
};

export type ShippingSettings = {
  enabled: boolean;
  policyNote: string;
  handlingMinDays: number;
  handlingMaxDays: number;
  zones: ShippingZone[];
};

export type ShippingQuote =
  | { configured: false; serviceable: false; message: string }
  | { configured: true; serviceable: false; message: string }
  | {
      configured: true;
      serviceable: true;
      zoneName: string;
      shippingFeePaise: number;
      freeShippingApplied: boolean;
      deliveryMinDays: number;
      deliveryMaxDays: number;
      message: string;
    };

export const emptyShippingSettings: ShippingSettings = {
  enabled: false,
  policyNote: "",
  handlingMinDays: 0,
  handlingMaxDays: 0,
  zones: [],
};

export function isIndianPincode(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{5}$/.test(value.trim());
}

function cleanZone(value: unknown): ShippingZone | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const zone = value as Record<string, unknown>;
  const id = typeof zone.id === "string" ? zone.id.trim() : "";
  const name = typeof zone.name === "string" ? zone.name.trim() : "";
  const rawPincodes = Array.isArray(zone.pincodes) ? zone.pincodes : [];
  if (!rawPincodes.length || rawPincodes.length > 2000 || !rawPincodes.every(isIndianPincode)) return null;
  const pincodes = rawPincodes.map((pin) => pin.trim());
  const fee = Number(zone.shippingFeePaise);
  const freeAbove = zone.freeShippingAbovePaise == null ? null : Number(zone.freeShippingAbovePaise);
  const minDays = Number(zone.deliveryMinDays);
  const maxDays = Number(zone.deliveryMaxDays);
  if (!id || id.length > 80 || !name || name.length > 60 || !pincodes.length ||
      !Number.isSafeInteger(fee) || fee < 0 || fee > 10_000_000 ||
      (freeAbove !== null && (!Number.isSafeInteger(freeAbove) || freeAbove < 0 || freeAbove > 100_000_000)) ||
      !Number.isInteger(minDays) || minDays < 1 || minDays > 60 ||
      !Number.isInteger(maxDays) || maxDays < minDays || maxDays > 60) return null;
  return {
    id, name, pincodes: [...new Set(pincodes)],
    shippingFeePaise: fee,
    freeShippingAbovePaise: freeAbove,
    deliveryMinDays: minDays,
    deliveryMaxDays: maxDays,
  };
}

export function validateShippingSettings(value: unknown): { settings?: ShippingSettings; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Invalid shipping settings." };
  const data = value as Record<string, unknown>;
  if (typeof data.enabled !== "boolean") return { error: "Choose whether shipping rules are enabled." };
  const policyNote = typeof data.policyNote === "string" ? data.policyNote.trim() : "";
  if (policyNote.length > 1200) return { error: "Shipping policy note must be 1,200 characters or fewer." };
  const handlingMinDays = Number(data.handlingMinDays);
  const handlingMaxDays = Number(data.handlingMaxDays);
  if (!Number.isInteger(handlingMinDays) || handlingMinDays < 0 || handlingMinDays > 30 ||
      !Number.isInteger(handlingMaxDays) || handlingMaxDays < handlingMinDays || handlingMaxDays > 30) {
    return { error: "Enter valid handling times between 0 and 30 days, with the maximum not below the minimum." };
  }
  if (!Array.isArray(data.zones) || data.zones.length > 50) return { error: "Add up to 50 delivery zones." };
  const zones: ShippingZone[] = [];
  const seen = new Set<string>();
  for (const item of data.zones) {
    const zone = cleanZone(item);
    if (!zone) return { error: "Each zone needs a name, valid 6-digit PIN codes, a valid fee and a valid delivery estimate." };
    for (const pin of zone.pincodes) {
      if (seen.has(pin)) return { error: `PIN code ${pin} appears in more than one delivery zone.` };
      seen.add(pin);
    }
    zones.push(zone);
  }
  if (data.enabled && zones.length === 0) return { error: "Add at least one delivery zone before enabling shipping." };
  return { settings: { enabled: data.enabled, policyNote, handlingMinDays, handlingMaxDays, zones } };
}

export async function getShippingSettings(): Promise<ShippingSettings> {
  const snapshot = await adminDb().collection("settings").doc("shipping").get();
  if (!snapshot.exists) return emptyShippingSettings;
  const data = snapshot.data() ?? {};
  const validated = validateShippingSettings({
    enabled: data.enabled === true,
    policyNote: typeof data.policyNote === "string" ? data.policyNote : "",
    handlingMinDays: Number(data.handlingMinDays ?? 0),
    handlingMaxDays: Number(data.handlingMaxDays ?? 0),
    zones: Array.isArray(data.zones) ? data.zones : [],
  });
  return validated.settings ?? emptyShippingSettings;
}

export function quoteShipping(settings: ShippingSettings, pincode: string, subtotalPaise = 0): ShippingQuote {
  if (!settings.enabled || settings.zones.length === 0) {
    return { configured: false, serviceable: false, message: "Shipping availability is being configured. Please check again soon." };
  }
  if (!isIndianPincode(pincode)) {
    return { configured: true, serviceable: false, message: "Enter a valid 6-digit Indian PIN code." };
  }
  const zone = settings.zones.find((item) => item.pincodes.includes(pincode.trim()));
  if (!zone) {
    return { configured: true, serviceable: false, message: "Delivery is not currently configured for this PIN code." };
  }
  const freeShippingApplied = zone.freeShippingAbovePaise !== null && subtotalPaise >= zone.freeShippingAbovePaise;
  const shippingFeePaise = freeShippingApplied ? 0 : zone.shippingFeePaise;
  return {
    configured: true,
    serviceable: true,
    zoneName: zone.name,
    shippingFeePaise,
    freeShippingApplied,
    deliveryMinDays: zone.deliveryMinDays + settings.handlingMinDays,
    deliveryMaxDays: zone.deliveryMaxDays + settings.handlingMaxDays,
    message: freeShippingApplied
      ? "Delivery is available with free shipping for this order."
      : "Delivery is available to this PIN code.",
  };
}
