"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { productCategories } from "@/lib/firebase/admin-validation";

type AdminProduct = {
  id: string; name: string; flavour: string; category: string; description?: string;
  imageUrl?: string; sku?: string; mrpPaise?: number | null;
  ingredients?: string; allergenInfo?: string; nutritionInfo?: string;
  storageInstructions?: string; shelfLife?: string; manufacturerName?: string;
  manufacturerAddress?: string; fssaiLicenseNumber?: string; countryOfOrigin?: string; packImageVerified?: boolean;
  pricePaise: number; netWeightGrams: number; stockQuantity: number;
  isActive: boolean; visibility: "draft" | "published"; sortOrder?: number;
};
type AdminOrder = {
  id: string; orderNumber?: string; userId: string; demoOrder?: boolean; items?: Array<{ nameSnapshot: string; quantity: number; lineTotalPaise: number }>;
  totalPaise: number; status: string; paymentStatus: string; paymentMode?: string; paymentId?: string; refundedPaise?: number; refundsInFlightPaise?: number; inventoryIssue?: string; createdAt?: unknown;
  refunds?: Array<{ refundId: string; amountPaise: number; status: string; reason?: string }>;
  shiprocketOrderId?: string; shiprocketShipmentId?: string; shiprocketAwb?: string; shiprocketStatus?: string; shiprocketDraftState?: string;
  carrier?: string; trackingNumber?: string; trackingUrl?: string;
};
type Coupon = { id: string; code: string; discountType: "percent" | "fixed"; discountValue: number; isActive: boolean; minOrderPaise?: number; maxDiscountPaise?: number | null; usageLimit?: number | null; usedCount?: number; reservedCount?: number; startsAt?: string | null; expiresAt?: string | null };
type ShippingZoneForm = {
  id: string;
  name: string;
  pincodes: string;
  shippingFeeRupees: string;
  freeShippingAboveRupees: string;
  deliveryMinDays: number;
  deliveryMaxDays: number;
};
type ShippingForm = {
  enabled: boolean;
  policyNote: string;
  handlingMinDays: number;
  handlingMaxDays: number;
  zones: ShippingZoneForm[];
};
const blankShippingForm: ShippingForm = {
  enabled: false, policyNote: "", handlingMinDays: 0, handlingMaxDays: 0, zones: [],
};
const isDemoCatalogueMode = process.env.NEXT_PUBLIC_CATALOGUE_DEMO_MODE === "true";

type ProductForm = Omit<AdminProduct, "id">;
const blankProduct: ProductForm = {
  name: "", flavour: "", category: "Classic", description: "", imageUrl: "", sku: "",
  mrpPaise: null, ingredients: "", allergenInfo: "", nutritionInfo: "",
  storageInstructions: "", shelfLife: "", manufacturerName: "", manufacturerAddress: "",
  fssaiLicenseNumber: "", countryOfOrigin: "India", packImageVerified: false,
  pricePaise: 0, netWeightGrams: 83, stockQuantity: 0, isActive: true, visibility: "draft", sortOrder: 0
};

function money(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format((paise || 0) / 100);
}
function dateLabel(value: unknown) {
  let date: Date | null = null;
  if (typeof value === "string") date = new Date(value);
  else if (value && typeof value === "object" && "_seconds" in value) date = new Date(Number((value as { _seconds: number })._seconds) * 1000);
  return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date) : "—";
}

const publishRequirements: Array<[keyof ProductForm, string]> = [
  ["imageUrl", "Pack photo URL"],
  ["packImageVerified", "Confirm exact POKHAR'S pack photo and flavour"],
  ["ingredients", "Approved ingredient list"],
  ["allergenInfo", "Allergen declaration"],
  ["nutritionInfo", "Verified nutrition information"],
  ["manufacturerName", "Manufacturer / packer name"],
  ["manufacturerAddress", "Manufacturer / packer address"],
  ["fssaiLicenseNumber", "FSSAI licence number"],
];

function missingPublishDetails(product: ProductForm | AdminProduct) {
  if (isDemoCatalogueMode) return [];
  return publishRequirements
    .filter(([key]) => {
      if (key === "packImageVerified") return product.packImageVerified !== true;
      if (key === "fssaiLicenseNumber") return !/^[12]\d{13}$/.test(String(product.fssaiLicenseNumber ?? "").trim());
      const value = product[key];
      if (typeof value !== "string" || !value.trim()) return true;
      const normalized = value.trim().toLowerCase().replace(/[.,:;!?]+/g, "").replace(/\s+/g, " ");
      return ["exact ingredient list", "verified allergen declaration", "verified nutrition information", "legal business name and address", "actual licence number", "actual license number"].includes(normalized)
        || /^(enter|add|insert|replace with|to be confirmed|tbd|todo)\b/i.test(normalized);
    })
    .map(([, label]) => label);
}

export default function AdminPage() {
  const { user, loading, configured, signInWithGoogle, signOut } = useAuth();
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(false);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [tab, setTab] = useState<"overview" | "products" | "inventory" | "orders" | "shipping" | "coupons">("overview");
  const [shippingForm, setShippingForm] = useState<ShippingForm>(blankShippingForm);
  const [productForm, setProductForm] = useState<ProductForm>(blankProduct);
  const [editing, setEditing] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponType, setCouponType] = useState<"percent" | "fixed">("percent");
  const [couponValue, setCouponValue] = useState(10);
  const [couponActive, setCouponActive] = useState(false);
  const [couponMinOrderRupees, setCouponMinOrderRupees] = useState(0);
  const [couponMaxDiscountRupees, setCouponMaxDiscountRupees] = useState("");
  const [couponUsageLimit, setCouponUsageLimit] = useState("");
  const [couponExpiresAt, setCouponExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadProgress, setImageUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const token = await getFirebaseAuth()?.currentUser?.getIdToken();
    if (!token) throw new Error("Sign in to continue.");
    const response = await fetch(path, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...init.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The admin request could not be completed.");
    return data;
  }, []);

  const loadData = useCallback(async () => {
    setChecking(true); setError(null);
    try {
      await api("/api/admin/access");
      setAuthorized(true);
      const [nextProducts, nextOrders, nextCoupons, nextShipping] = await Promise.all([
        api("/api/admin/products"), api("/api/admin/orders"), api("/api/admin/coupons"), api("/api/admin/shipping"),
      ]);
      setProducts(nextProducts); setOrders(nextOrders); setCoupons(nextCoupons);
      const savedShipping = nextShipping.settings ?? {};
      setShippingForm({
        enabled: savedShipping.enabled === true,
        policyNote: typeof savedShipping.policyNote === "string" ? savedShipping.policyNote : "",
        handlingMinDays: Number(savedShipping.handlingMinDays ?? 0),
        handlingMaxDays: Number(savedShipping.handlingMaxDays ?? 0),
        zones: Array.isArray(savedShipping.zones) ? savedShipping.zones.map((zone: {
          id?: string; name?: string; pincodes?: string[]; shippingFeePaise?: number;
          freeShippingAbovePaise?: number | null; deliveryMinDays?: number; deliveryMaxDays?: number;
        }, index: number) => ({
          id: zone.id ?? `zone-${index + 1}`,
          name: zone.name ?? "",
          pincodes: Array.isArray(zone.pincodes) ? zone.pincodes.join(", ") : "",
          shippingFeeRupees: (Number(zone.shippingFeePaise ?? 0) / 100).toFixed(2),
          freeShippingAboveRupees: zone.freeShippingAbovePaise == null ? "" : (Number(zone.freeShippingAbovePaise) / 100).toFixed(2),
          deliveryMinDays: Number(zone.deliveryMinDays ?? 1),
          deliveryMaxDays: Number(zone.deliveryMaxDays ?? 5),
        })) : [],
      });
    } catch (cause) {
      setAuthorized(false);
      setError(cause instanceof Error ? cause.message : "Admin data could not be loaded.");
    } finally { setChecking(false); }
  }, [api]);

  useEffect(() => { if (!loading && user) void loadData(); else if (!user) setAuthorized(false); }, [loading, user, loadData]);

  const lowStock = products.filter((product) => product.stockQuantity <= 5);
  // Keep unpaid demo checkout attempts in the admin audit trail, but out of
  // normal order activity. Only captured test payments remain in the main list.
  const unpaidTestAttempts = orders.filter((order) => order.paymentMode === "test" && order.paymentStatus !== "paid");
  const operationalOrders = orders.filter((order) => order.paymentMode !== "test" || order.paymentStatus === "paid");
  const paidOrders = orders.filter((order) => order.paymentStatus === "paid" && order.paymentMode !== "test");
  const revenue = paidOrders.reduce((sum, order) => sum + (Number(order.totalPaise) || 0), 0);
  const paidCount = paidOrders.length;
  const activeProducts = products.filter((product) => product.isActive && product.visibility === "published").length;
  const publishGaps = missingPublishDetails(productForm);

  async function uploadProductImage(file: File) {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setError("Choose a JPG, PNG or WebP product photo.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Product photos must be 8 MB or smaller.");
      return;
    }

    setImageUploading(true);
    setImageUploadProgress(0);
    setError(null);
    setNotice(null);

    try {
      const token = await getFirebaseAuth()?.currentUser?.getIdToken();
      if (!token) throw new Error("Sign in with the owner account to upload product photos.");

      const authResponse = await fetch("/api/admin/imagekit-auth", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const authData = await authResponse.json().catch(() => ({}));
      if (!authResponse.ok) {
        throw new Error(authData.error || "Image upload is not configured yet.");
      }

      const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const baseName = (productForm.name.trim() || file.name.replace(/\.[^.]+$/, ""))
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "pokhars-product";
      const form = new FormData();
      form.append("file", file);
      form.append("fileName", `${baseName}-${Date.now()}.${extension}`);
      form.append("folder", "/pokhars/products");
      form.append("useUniqueFileName", "true");
      form.append("isPrivateFile", "false");
      form.append("tags", "pokhars,product");

      for (const key of ["token", "expire", "signature", "publicKey"] as const) {
        if (typeof authData[key] !== "string" && typeof authData[key] !== "number") {
          throw new Error("Image upload authorisation is incomplete. Check the ImageKit keys in Vercel.");
        }
        form.append(key, String(authData[key]));
      }

      const uploaded = await new Promise<{ url: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "https://upload.imagekit.io/api/v1/files/upload");
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setImageUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onerror = () => reject(new Error("ImageKit upload failed due to a network error. Please retry."));
        xhr.onload = () => {
          let data: { url?: string; message?: string; help?: string } = {};
          try { data = JSON.parse(xhr.responseText) as typeof data; } catch { /* handled below */ }
          if (xhr.status < 200 || xhr.status >= 300 || !data.url) {
            reject(new Error(data.message || data.help || "ImageKit could not upload this photo."));
            return;
          }
          resolve({ url: data.url });
        };
        xhr.send(form);
      });

      setProductForm((current) => ({ ...current, imageUrl: uploaded.url, packImageVerified: false }));
      setNotice("Product photo uploaded. Save the product to attach this image to its catalogue record.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Product photo could not be uploaded.");
    } finally {
      setImageUploading(false);
      setImageUploadProgress(0);
    }
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try {
      await api(editing ? `/api/admin/products/${editing}` : "/api/admin/products", { method: editing ? "PATCH" : "POST", body: JSON.stringify(productForm) });
      setProductForm(blankProduct); setEditing(null); setNotice("Product saved."); await loadData();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Product could not be saved."); }
    finally { setBusy(false); }
  }

  function editProduct(product: AdminProduct) {
    const { id, ...form } = product;
    setEditing(id); setProductForm({ ...blankProduct, ...form }); setTab("products");
  }

  async function archiveProduct(product: AdminProduct) {
    if (!window.confirm(`Hide “${product.name}” from the storefront?`)) return;
    setBusy(true); setError(null);
    try { await api(`/api/admin/products/${product.id}`, { method: "DELETE" }); setNotice("Product hidden from the storefront."); await loadData(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Product could not be hidden."); }
    finally { setBusy(false); }
  }

  async function refundOrder(order: AdminOrder, amountPaise: number | undefined, idempotencyKey: string): Promise<boolean> {
    const available = Math.max(0, order.totalPaise - (order.refundedPaise ?? 0) - (order.refundsInFlightPaise ?? 0));
    const amount = amountPaise ?? available;
    if (amount < 100 || amount > available) {
      setError("Enter a refund amount from ₹1 up to the remaining refundable balance.");
      return false;
    }
    const display = money(amount);
    if (!window.confirm("Initiate a " + display + " refund for order " + (order.orderNumber ?? order.id) + "? This request is sent to Razorpay and cannot be undone.")) return false;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await api(`/api/admin/orders/${order.id}/refund`, {
        method: "POST",
        body: JSON.stringify({ amountPaise: amount, reason: "Admin initiated refund", idempotencyKey }),
      });
      setNotice("Refund request sent to Razorpay: " + display + ". Status: " + String(result.status ?? "pending") + ".");
      await loadData();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Refund could not be initiated.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createCourierDraft(order: AdminOrder): Promise<boolean> {
    if (order.paymentMode === "test" || order.paymentStatus !== "paid") {
      setError("Only captured live customer orders can be sent to Shiprocket.");
      return false;
    }
    if (!window.confirm("Create a Shiprocket custom-order draft for " + (order.orderNumber ?? order.id) + "? This will NOT assign an AWB, schedule pickup or dispatch the parcel.")) return false;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await api(`/api/admin/orders/${order.id}/shipping-draft`, { method: "POST", body: JSON.stringify({}) });
      setNotice("Shiprocket custom-order draft created. No pickup or dispatch requested. Courier order ID: " + String(result.orderId ?? "created"));
      await loadData();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Shiprocket draft could not be created.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function updateOrder(order: AdminOrder, status: string, shipment?: { carrier: string; trackingNumber: string; trackingUrl: string }) {
    setBusy(true); setError(null);
    try {
      await api(`/api/admin/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ status, ...(shipment ?? {}) }) });
      setNotice(status === "shipped" ? `Courier tracking saved for order ${order.orderNumber ?? order.id}.` : `Order ${order.orderNumber ?? order.id} updated.`);
      await loadData();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Order status could not be updated."); }
    finally { setBusy(false); }
  }

  async function sendTestStatusEmail(order: AdminOrder, status: "processing" | "shipped" | "delivered") {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api(`/api/admin/orders/${order.id}/test-status-email`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      setNotice(`Sample ${status} email sent for order ${order.orderNumber ?? order.id}. The order status and fulfilment records were not changed.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sample status email could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTestTrackingEmail(order: AdminOrder) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api(`/api/admin/orders/${order.id}/test-tracking-email`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotice(`Sample courier tracking email sent for order ${order.orderNumber ?? order.id}. No courier booking or shipment was created.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sample tracking email could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  function updateShippingZone(index: number, patch: Partial<ShippingZoneForm>) {
    setShippingForm((current) => ({
      ...current,
      zones: current.zones.map((zone, zoneIndex) => zoneIndex === index ? { ...zone, ...patch } : zone),
    }));
  }

  function addShippingZone() {
    setShippingForm((current) => ({
      ...current,
      zones: [...current.zones, {
        id: `zone-${Date.now().toString(36)}`,
        name: "",
        pincodes: "",
        shippingFeeRupees: "0",
        freeShippingAboveRupees: "",
        deliveryMinDays: 3,
        deliveryMaxDays: 7,
      }],
    }));
  }

  async function saveShipping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const zones = shippingForm.zones.map((zone) => ({
        id: zone.id,
        name: zone.name.trim(),
        pincodes: zone.pincodes.split(/[\s,;]+/).map((pin) => pin.trim()).filter(Boolean),
        shippingFeePaise: Math.round(Number(zone.shippingFeeRupees) * 100),
        freeShippingAbovePaise: zone.freeShippingAboveRupees.trim() === ""
          ? null : Math.round(Number(zone.freeShippingAboveRupees) * 100),
        deliveryMinDays: Number(zone.deliveryMinDays),
        deliveryMaxDays: Number(zone.deliveryMaxDays),
      }));
      await api("/api/admin/shipping", {
        method: "PUT",
        body: JSON.stringify({
          enabled: shippingForm.enabled,
          policyNote: shippingForm.policyNote,
          handlingMinDays: shippingForm.handlingMinDays,
          handlingMaxDays: shippingForm.handlingMaxDays,
          zones,
        }),
      });
      setNotice("Shipping zones and delivery rules saved.");
      await loadData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Shipping rules could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function createCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try {
      await api("/api/admin/coupons", { method: "POST", body: JSON.stringify({
        code: couponCode.toUpperCase(), discountType: couponType, discountValue: couponValue,
        isActive: couponActive, minOrderPaise: Math.round(couponMinOrderRupees * 100),
        maxDiscountPaise: couponMaxDiscountRupees ? Math.round(Number(couponMaxDiscountRupees) * 100) : null,
        usageLimit: couponUsageLimit ? Number(couponUsageLimit) : null,
        expiresAt: couponExpiresAt ? new Date(couponExpiresAt).toISOString() : null,
      }) });
      setCouponCode(""); setCouponActive(false); setCouponMinOrderRupees(0); setCouponMaxDiscountRupees(""); setCouponUsageLimit(""); setCouponExpiresAt("");
      setNotice(couponActive ? "Active coupon created and ready for checkout." : "Inactive coupon created."); await loadData();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Coupon could not be saved."); }
    finally { setBusy(false); }
  }

  async function toggleCoupon(coupon: Coupon) {
    setBusy(true); setError(null);
    try {
      await api(`/api/admin/coupons/${coupon.id}`, { method: "PATCH", body: JSON.stringify({ ...coupon, isActive: !coupon.isActive }) });
      setNotice(coupon.isActive ? "Coupon deactivated." : "Coupon activated for checkout."); await loadData();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Coupon could not be updated."); }
    finally { setBusy(false); }
  }

  const tabs = useMemo(() => [
    ["overview", "Overview"], ["products", "Products"], ["inventory", `Inventory${lowStock.length ? ` · ${lowStock.length}` : ""}`], ["orders", "Orders"], ["shipping", "Shipping"], ["coupons", "Coupons"],
  ] as const, [lowStock.length]);

  if (loading || checking) return <main className="admin-gate"><div className="admin-gate-card"><span className="admin-mark">P</span><p>Checking secure access…</p></div></main>;
  if (!configured) return <main className="admin-gate"><div className="admin-gate-card"><span className="admin-mark">P</span><h1>Admin setup needed</h1><p>Connect Firebase Authentication before using the dashboard.</p><Link href="/">Return to store</Link></div></main>;
  if (!user) return <main className="admin-gate"><div className="admin-gate-card"><span className="admin-mark">P</span><p className="admin-eyebrow">POKHAR’S STORE</p><h1>Admin sign in</h1><p>Sign in with the owner account configured for this dashboard.</p><button className="admin-primary" onClick={() => void signInWithGoogle()}>Continue with Google</button><Link href="/">Back to storefront</Link></div></main>;
  if (!authorized) return <main className="admin-gate"><div className="admin-gate-card"><span className="admin-mark">P</span><p className="admin-eyebrow">RESTRICTED AREA</p><h1>Admin access required</h1><p>Your signed-in account is not on the server’s admin allowlist and does not have the admin claim.</p>{error && <p className="admin-error">{error}</p>}<div className="admin-gate-actions"><button className="admin-primary" onClick={() => void loadData()}>Try again</button><button className="admin-secondary" onClick={() => void signOut()}>Sign out</button></div><Link href="/">Back to storefront</Link></div></main>;

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/"><span className="admin-mark">P</span><span>POKHAR’S<small>STORE ADMIN</small></span></Link>
        <nav className="admin-nav" aria-label="Admin sections">{tabs.map(([id, label]) => <button key={id} className={tab === id ? "selected" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>
        <div className="admin-sidebar-bottom"><span>{user.email}</span><button onClick={() => void signOut()}>Sign out</button><Link href="/">← View storefront</Link></div>
      </aside>
      <section className="admin-main">
        <header className="admin-topbar"><div><p className="admin-eyebrow">POKHAR’S · OPERATIONS</p><h1>{tabs.find(([id]) => id === tab)?.[1]}</h1></div><button className="admin-secondary" onClick={() => void loadData()}>Refresh data</button></header>
        {isDemoCatalogueMode && <div className="admin-alert warning admin-demo-notice" role="status"><strong>DEMO CATALOGUE MODE · NOT FOR SALE</strong><span>Sample products are for website development and Razorpay Test Mode only. Demo payments are simulations; no demo orders are dispatched, no stock is reduced and no demo payment is counted as live sales.</span></div>}
        {error && <div className="admin-alert error" role="alert">{error}</div>}{notice && <div className="admin-alert success" role="status">{notice}</div>}
        {tab === "overview" && <>
          <div className="admin-metrics">
            <article><span>LIVE PAID REVENUE · LOADED ORDERS</span><strong>{money(revenue)}</strong><small>From {paidCount} live order{paidCount === 1 ? "" : "s"} marked paid</small></article>
            <article><span>LIVE PAID ORDERS</span><strong>{paidCount}</strong><small>{unpaidTestAttempts.length} unpaid test attempts kept separate from order activity</small></article>
            <article><span>PUBLISHED PRODUCTS</span><strong>{activeProducts}</strong><small>Active and visible in the storefront</small></article>
            <article className={lowStock.length ? "attention" : ""}><span>LOW STOCK · 5 OR FEWER</span><strong>{lowStock.length}</strong><small>{lowStock.length ? "Review inventory" : "All products above alert level"}</small></article>
          </div>
          <section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">LATEST ACTIVITY</p><h2>Recent orders</h2></div><button className="admin-link-button" onClick={() => setTab("orders")}>View all →</button></div><OrderTable orders={operationalOrders.slice(0, 5)} busy={busy} updateOrder={updateOrder} refundOrder={refundOrder} createCourierDraft={createCourierDraft} sendTestStatusEmail={sendTestStatusEmail} sendTestTrackingEmail={sendTestTrackingEmail} /></section>
          <p className="admin-footnote">Revenue uses stored totals from non-test orders marked paid. Test orders are labeled and excluded. Refunds, fees and settlement reconciliation are not included.</p>
        </>}
        {tab === "products" && <div className="admin-products-layout">
          <section className="admin-panel admin-form-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">CATALOGUE</p><h2>{editing ? "Edit product" : "Add product"}</h2></div>{editing && <button className="admin-link-button" onClick={() => { setEditing(null); setProductForm(blankProduct); }}>Cancel</button>}</div>
            <form className="admin-form" onSubmit={saveProduct}>
              <div className="admin-form-section-title">Basic product details</div>
              <label>Product name<input required maxLength={120} value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} placeholder="Name printed on the pack" /></label>
              <div className="admin-form-row">
                <label>Flavour<input required maxLength={120} value={productForm.flavour} onChange={(e) => setProductForm({ ...productForm, flavour: e.target.value })} placeholder="Approved flavour name" /></label>
                <label>SKU / product code<input maxLength={40} value={productForm.sku ?? ""} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} placeholder="e.g. PKH-83-001" /></label>
              </div>
              <label>Category<select value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}>{productCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <div className="admin-form-row">
                <label>Selling price (₹)<input required type="number" min="0.01" step="0.01" value={productForm.pricePaise ? productForm.pricePaise / 100 : ""} onChange={(e) => setProductForm({ ...productForm, pricePaise: Math.round(Number(e.target.value) * 100) })} /></label>
                <label>MRP (₹)<input type="number" min="0" step="0.01" value={productForm.mrpPaise ? productForm.mrpPaise / 100 : ""} onChange={(e) => setProductForm({ ...productForm, mrpPaise: e.target.value ? Math.round(Number(e.target.value) * 100) : null })} /><small>Optional. Cannot be below selling price.</small></label>
              </div>
              <div className="admin-form-row"><label>Net weight (g)<input required type="number" min="1" step="1" value={productForm.netWeightGrams} onChange={(e) => setProductForm({ ...productForm, netWeightGrams: Number(e.target.value) })} /></label><label>Stock units<input required type="number" min="0" step="1" value={productForm.stockQuantity} onChange={(e) => setProductForm({ ...productForm, stockQuantity: Number(e.target.value) })} /></label></div>
              <div className="admin-form-section-title">Product photography</div>
              <label>Upload real pack photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={imageUploading || busy}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void uploadProductImage(file);
                  }}
                />
                <small>JPG, PNG or WebP · maximum 8 MB. Uploads securely to ImageKit under /pokhars/products.</small>
              </label>
              {imageUploading && (
                <div className="admin-image-upload-progress" role="status">
                  <span>Uploading product photo… {imageUploadProgress}%</span>
                  <div><i style={{ width: `${imageUploadProgress}%` }} /></div>
                </div>
              )}
              {productForm.imageUrl && (
                <div className="admin-image-preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={productForm.imageUrl} alt="Current product pack preview" />
                  <div><strong>PACK PHOTO READY</strong><a href={productForm.imageUrl} target="_blank" rel="noreferrer">Open original ↗</a></div>
                </div>
              )}
              <label>Or paste an existing HTTPS image URL
                <input type="url" placeholder="https://…" value={productForm.imageUrl ?? ""} onChange={(e) => setProductForm({ ...productForm, imageUrl: e.target.value, packImageVerified: false })} />
                <small>The URL is saved with the product when you press Save product.</small>
              </label>
              <label className="admin-check admin-image-confirm">
                <input type="checkbox" checked={productForm.packImageVerified === true} onChange={(e) => setProductForm({ ...productForm, packImageVerified: e.target.checked })} />
                I confirm this photo shows the exact POKHAR’S pack and selected flavour — not a reference or competitor image.
              </label>
              <small className="admin-image-confirm-note">Changing the image resets this confirmation. Review the preview carefully before checking.</small>
              <div className="admin-form-section-title">Ingredients and food-label information</div>
              <label>Ingredients<textarea required={productForm.visibility === "published" && productForm.isActive} rows={3} maxLength={3000} value={productForm.ingredients ?? ""} onChange={(e) => setProductForm({ ...productForm, ingredients: e.target.value })} placeholder="Enter the approved ingredient statement from the finished pack." /></label>
              <label>Allergen declaration<textarea required={productForm.visibility === "published" && productForm.isActive} rows={2} maxLength={1200} value={productForm.allergenInfo ?? ""} onChange={(e) => setProductForm({ ...productForm, allergenInfo: e.target.value })} placeholder="Enter the verified allergen statement. Do not guess." /></label>
              <label>Nutrition information<textarea required={productForm.visibility === "published" && productForm.isActive} rows={3} maxLength={2000} value={productForm.nutritionInfo ?? ""} onChange={(e) => setProductForm({ ...productForm, nutritionInfo: e.target.value })} placeholder="Enter verified nutrition values and serving basis from the approved label." /></label>
              <label>Storage instructions<input maxLength={500} value={productForm.storageInstructions ?? ""} onChange={(e) => setProductForm({ ...productForm, storageInstructions: e.target.value })} placeholder="Approved storage directions" /></label>
              <label>Shelf life<input maxLength={120} value={productForm.shelfLife ?? ""} onChange={(e) => setProductForm({ ...productForm, shelfLife: e.target.value })} placeholder="As validated for the finished product" /></label>
              <div className="admin-form-section-title">Manufacturer / packer details</div>
              <label>Manufacturer / packer name<input required={productForm.visibility === "published" && productForm.isActive} maxLength={180} value={productForm.manufacturerName ?? ""} onChange={(e) => setProductForm({ ...productForm, manufacturerName: e.target.value })} /></label>
              <label>Manufacturer / packer full address<textarea required={productForm.visibility === "published" && productForm.isActive} rows={2} maxLength={500} value={productForm.manufacturerAddress ?? ""} onChange={(e) => setProductForm({ ...productForm, manufacturerAddress: e.target.value })} /></label>
              <div className="admin-form-row">
                <label>FSSAI licence number<input required={productForm.visibility === "published" && productForm.isActive} maxLength={30} value={productForm.fssaiLicenseNumber ?? ""} onChange={(e) => setProductForm({ ...productForm, fssaiLicenseNumber: e.target.value })} /></label>
                <label>Country of origin<input maxLength={80} value={productForm.countryOfOrigin ?? "India"} onChange={(e) => setProductForm({ ...productForm, countryOfOrigin: e.target.value })} /></label>
              </div>
              <label>Short product description<textarea rows={3} maxLength={2000} value={productForm.description ?? ""} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} placeholder="A short, factual product description." /></label>
              {productForm.visibility === "published" && productForm.isActive && publishGaps.length > 0 && <div className="admin-alert warning"><strong>Not ready to publish.</strong> Complete: {publishGaps.join(", ")}. Use approved product and pack information only.</div>}
              <div className="admin-form-row"><label className="admin-check"><input type="checkbox" checked={productForm.isActive} onChange={(e) => setProductForm({ ...productForm, isActive: e.target.checked })} /> Active</label><label>Visibility<select value={productForm.visibility} onChange={(e) => setProductForm({ ...productForm, visibility: e.target.value as ProductForm["visibility"] })}><option value="draft">Draft</option><option value="published">Published</option></select></label></div>
              <button className="admin-primary" disabled={busy || imageUploading}>{busy ? "Saving…" : editing ? "Save changes" : "Create product"}</button>
            </form>
          </section>
          <section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">{products.length} TOTAL</p><h2>Products</h2></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th /></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.sku ? product.sku + " · " : ""}{product.flavour} · {product.category} · {product.netWeightGrams} g</small></td><td><strong>{money(product.pricePaise)}</strong>{product.mrpPaise && product.mrpPaise > product.pricePaise ? <small>MRP {money(product.mrpPaise)}</small> : null}</td><td>{product.stockQuantity}</td><td><span className={`admin-pill ${product.visibility === "published" && product.isActive ? "green" : "muted"}`}>{product.isActive ? product.visibility : "inactive"}</span>{isDemoCatalogueMode && <small>DEMO · NOT FOR SALE</small>}{missingPublishDetails(product).length > 0 && <small>{missingPublishDetails(product).length} publish details missing</small>}</td><td className="admin-row-actions"><button onClick={() => editProduct(product)}>Edit</button><button onClick={() => void archiveProduct(product)}>{product.isActive ? "Hide" : "Hidden"}</button></td></tr>)}</tbody></table>{products.length === 0 && <EmptyState>No product documents were found.</EmptyState>}</div></section>
        </div>}
        {tab === "inventory" && <section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">STOCK CONTROL</p><h2>Inventory</h2></div><span className="admin-pill amber">Alert at 5 units</span></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Product</th><th>On hand</th><th>Storefront</th><th>Action</th></tr></thead><tbody>{products.slice().sort((a, b) => a.stockQuantity - b.stockQuantity).map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.category} · {product.netWeightGrams} g</small></td><td><strong className={product.stockQuantity <= 5 ? "stock-low" : ""}>{product.stockQuantity}</strong></td><td>{product.isActive && product.visibility === "published" ? "Published" : "Hidden"}</td><td><button className="admin-row-button" onClick={() => editProduct(product)}>Adjust stock</button></td></tr>)}</tbody></table></div></section>}
        {tab === "orders" && <>
          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div><p className="admin-eyebrow">CUSTOMER ORDERS</p><h2>Orders</h2></div>
              <span className="admin-pill muted">{operationalOrders.length} orders</span>
            </div>
            <OrderTable orders={operationalOrders} busy={busy} updateOrder={updateOrder} refundOrder={refundOrder} createCourierDraft={createCourierDraft} sendTestStatusEmail={sendTestStatusEmail} sendTestTrackingEmail={sendTestTrackingEmail} />
          </section>
          {unpaidTestAttempts.length > 0 && (
            <details className="admin-test-attempts">
              <summary>
                <span><strong>Unpaid test attempts</strong><small>Expired, failed or incomplete demo checkouts · retained for audit only</small></span>
                <span className="admin-test-attempt-count">{unpaidTestAttempts.length}</span>
              </summary>
              <div className="admin-test-attempt-body">
                <OrderTable orders={unpaidTestAttempts} busy={busy} updateOrder={updateOrder} refundOrder={refundOrder} createCourierDraft={createCourierDraft} sendTestStatusEmail={sendTestStatusEmail} sendTestTrackingEmail={sendTestTrackingEmail} />
              </div>
            </details>
          )}
        </>}
        {tab === "shipping" && (
          <div className="admin-products-layout shipping-admin-layout">
            <section className="admin-panel admin-form-panel">
              <div className="admin-panel-heading"><div><p className="admin-eyebrow">DELIVERY CONFIGURATION</p><h2>Shipping rules</h2></div><span className={`admin-pill ${shippingForm.enabled ? "green" : "muted"}`}>{shippingForm.enabled ? "enabled" : "disabled"}</span></div>
              <div className="admin-alert warning">
                PIN-code serviceability is manual. Only add PIN codes you have confirmed with your chosen courier or delivery partner. This does not query a courier network in real time.
              </div>
              <form className="admin-form" onSubmit={saveShipping}>
                <label className="admin-shipping-enable">
                  <input type="checkbox" checked={shippingForm.enabled} onChange={(event) => setShippingForm((current) => ({ ...current, enabled: event.target.checked }))} />
                  Enable configured shipping rules
                </label>
                <div className="admin-form-section-title">Handling and delivery estimates</div>
                <div className="admin-shipping-grid">
                  <label>Handling time · minimum days
                    <input type="number" min="0" max="30" step="1" value={shippingForm.handlingMinDays} onChange={(event) => setShippingForm((current) => ({ ...current, handlingMinDays: Number(event.target.value) }))} required />
                  </label>
                  <label>Handling time · maximum days
                    <input type="number" min={shippingForm.handlingMinDays} max="30" step="1" value={shippingForm.handlingMaxDays} onChange={(event) => setShippingForm((current) => ({ ...current, handlingMaxDays: Number(event.target.value) }))} required />
                  </label>
                </div>
                <label>Shipping policy note (optional)
                  <textarea rows={4} maxLength={1200} value={shippingForm.policyNote} onChange={(event) => setShippingForm((current) => ({ ...current, policyNote: event.target.value }))} placeholder="Add a customer-facing note about dispatch, delays or delivery handling." />
                  <small>{shippingForm.policyNote.length}/1200 characters. Do not add delivery guarantees you cannot meet.</small>
                </label>
                <div className="admin-shipping-form-actions">
                  <button className="admin-primary" disabled={busy}>{busy ? "SAVING…" : "SAVE SHIPPING SETTINGS"}</button>
                  <button className="admin-secondary" type="button" disabled={busy} onClick={addShippingZone}>+ ADD DELIVERY ZONE</button>
                </div>
              </form>
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading"><div><p className="admin-eyebrow">{shippingForm.zones.length} CONFIGURED</p><h2>Delivery zones</h2></div></div>
              {shippingForm.zones.length === 0 ? (
                <EmptyState>No delivery zones yet. Add zones only after checking coverage with your courier partner.</EmptyState>
              ) : (
                <div className="admin-shipping-zones">
                  {shippingForm.zones.map((zone, index) => (
                    <article className="admin-shipping-zone" key={zone.id}>
                      <div className="admin-shipping-zone-heading"><strong>ZONE {index + 1}</strong><button type="button" className="admin-row-button" disabled={busy} onClick={() => setShippingForm((current) => ({ ...current, zones: current.zones.filter((_, i) => i !== index) }))}>REMOVE</button></div>
                      <label>Zone name
                        <input value={zone.name} maxLength={60} placeholder="e.g. Local delivery" onChange={(event) => updateShippingZone(index, { name: event.target.value })} />
                      </label>
                      <label>Serviceable PIN codes
                        <textarea rows={3} value={zone.pincodes} placeholder="846001, 846004, 846005" onChange={(event) => updateShippingZone(index, { pincodes: event.target.value.replace(/[^0-9,;\s]/g, "") })} />
                        <small>Enter only verified 6-digit PIN codes, separated by commas or spaces. Each PIN can belong to one zone only.</small>
                      </label>
                      <div className="admin-shipping-grid">
                        <label>Shipping fee (₹)
                          <input type="number" min="0" max="100000" step="0.01" value={zone.shippingFeeRupees} onChange={(event) => updateShippingZone(index, { shippingFeeRupees: event.target.value })} />
                        </label>
                        <label>Free shipping above (₹, optional)
                          <input type="number" min="0" max="1000000" step="0.01" value={zone.freeShippingAboveRupees} onChange={(event) => updateShippingZone(index, { freeShippingAboveRupees: event.target.value })} placeholder="Leave blank to disable" />
                        </label>
                        <label>Delivery estimate · min days
                          <input type="number" min="1" max="60" step="1" value={zone.deliveryMinDays} onChange={(event) => updateShippingZone(index, { deliveryMinDays: Number(event.target.value) })} />
                        </label>
                        <label>Delivery estimate · max days
                          <input type="number" min={zone.deliveryMinDays} max="60" step="1" value={zone.deliveryMaxDays} onChange={(event) => updateShippingZone(index, { deliveryMaxDays: Number(event.target.value) })} />
                        </label>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
        {tab === "coupons" && <div className="admin-products-layout"><section className="admin-panel admin-form-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">PROMOTIONS</p><h2>Create coupon</h2></div></div><div className="admin-alert warning">Coupons are validated again by the server when an order is created. Percentage discounts use a percentage; fixed discounts are entered in paise. Reserved uses are released when unpaid checkout attempts expire.</div><form className="admin-form" onSubmit={createCoupon}><label>Coupon code<input required minLength={3} maxLength={32} value={couponCode} onChange={(e) => setCouponCode(e.target.value.replace(/[^a-z0-9_-]/gi, "").toUpperCase())} /></label><label>Discount type<select value={couponType} onChange={(e) => setCouponType(e.target.value as "percent" | "fixed")}><option value="percent">Percentage</option><option value="fixed">Fixed amount (paise)</option></select></label><label>Discount value<input required type="number" min="1" max={couponType === "percent" ? 100 : undefined} step="1" value={couponValue} onChange={(e) => setCouponValue(Number(e.target.value))} /><small>Fixed amounts are entered in paise (₹1 = 100 paise).</small></label><label>Minimum cart value (₹)<input type="number" min="0" step="0.01" value={couponMinOrderRupees} onChange={(e) => setCouponMinOrderRupees(Number(e.target.value))} /></label><label>Maximum discount (₹, optional)<input type="number" min="0.01" step="0.01" value={couponMaxDiscountRupees} onChange={(e) => setCouponMaxDiscountRupees(e.target.value)} /></label><label>Usage limit (optional)<input type="number" min="1" step="1" value={couponUsageLimit} onChange={(e) => setCouponUsageLimit(e.target.value)} /></label><label>Expiry date (optional)<input type="datetime-local" value={couponExpiresAt} onChange={(e) => setCouponExpiresAt(e.target.value)} /></label><label className="admin-shipping-enable"><input type="checkbox" checked={couponActive} onChange={(e) => setCouponActive(e.target.checked)} /> Activate coupon immediately</label><button className="admin-primary" disabled={busy}>Create coupon</button></form></section><section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">{coupons.length} TOTAL</p><h2>Coupons</h2></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Code</th><th>Discount</th><th>Status</th><th /></tr></thead><tbody>{coupons.map((coupon) => <tr key={coupon.id}><td><strong>{coupon.code}</strong></td><td>{coupon.discountType === "percent" ? `${coupon.discountValue}%` : money(coupon.discountValue)}</td><td><span className={`admin-pill ${coupon.isActive ? "green" : "muted"}`}>{coupon.isActive ? "active" : "inactive"}</span></td><td><button className="admin-row-button" onClick={() => void toggleCoupon(coupon)} disabled={busy}>{coupon.isActive ? "Deactivate" : "Activate"}</button><small>{coupon.usedCount ?? 0} used · {coupon.reservedCount ?? 0} pending</small></td></tr>)}</tbody></table>{coupons.length === 0 && <EmptyState>No coupon documents were found.</EmptyState>}</div></section></div>}
      </section>
    </main>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) { return <div className="admin-empty">{children}</div>; }

function OrderTable({ orders, busy, updateOrder, refundOrder, createCourierDraft, sendTestStatusEmail, sendTestTrackingEmail }: { orders: AdminOrder[]; busy: boolean; updateOrder: (order: AdminOrder, status: string, shipment?: { carrier: string; trackingNumber: string; trackingUrl: string }) => Promise<void>; refundOrder: (order: AdminOrder, amountPaise: number | undefined, idempotencyKey: string) => Promise<boolean>; createCourierDraft: (order: AdminOrder) => Promise<boolean>; sendTestStatusEmail: (order: AdminOrder, status: "processing" | "shipped" | "delivered") => Promise<void>; sendTestTrackingEmail: (order: AdminOrder) => Promise<void> }) {
  const [shipmentDrafts, setShipmentDrafts] = useState<Record<string, { carrier: string; trackingNumber: string; trackingUrl: string }>>({});
  const [refundDrafts, setRefundDrafts] = useState<Record<string, string>>({});
  const [refundKeys, setRefundKeys] = useState<Record<string, { key: string; amountPaise?: number }>>({});
  const [testStatusDrafts, setTestStatusDrafts] = useState<Record<string, "processing" | "shipped" | "delivered">>({});
  const defaultShipment = (order: AdminOrder) => ({
    carrier: order.carrier ?? "",
    trackingNumber: order.trackingNumber ?? "",
    trackingUrl: order.trackingUrl ?? "",
  });
  const shipmentFor = (order: AdminOrder) => shipmentDrafts[order.id] ?? defaultShipment(order);
  const setShipmentField = (order: AdminOrder, field: "carrier" | "trackingNumber" | "trackingUrl", value: string) => {
    setShipmentDrafts((current) => ({
      ...current,
      [order.id]: { ...(current[order.id] ?? defaultShipment(order)), [field]: value },
    }));
  };

  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Date</th><th>Total</th><th>Payment</th><th>Status</th><th>Update</th></tr></thead><tbody>{orders.map((order) => {
    const canFulfil = order.paymentMode !== "test" && !order.inventoryIssue && order.paymentStatus === "paid";
    const nextStatus = canFulfil ? order.status === "confirmed" ? "processing" : order.status === "shipped" ? "delivered" : "" : "";
    const canManageShipment = canFulfil && (order.status === "processing" || order.status === "shipped");
    const shipment = shipmentFor(order);
    return <tr key={order.id}>
      <td>
        <strong>{order.orderNumber || order.id.slice(0, 10)}</strong>
        {order.paymentMode === "test" && <span className="admin-pill muted">TEST</span>}
        {order.inventoryIssue && <span className="admin-pill muted">INVENTORY REVIEW</span>}
        <details className="admin-order-detail">
          <summary>{order.items?.length ?? 0} line items · Details</summary>
          <div>
            {order.items?.length ? order.items.map((item, index) => <p key={`${item.nameSnapshot}-${index}`}>{item.nameSnapshot} × {item.quantity} <b>{money(item.lineTotalPaise)}</b></p>) : <p>No item snapshot recorded.</p>}
            {order.inventoryIssue && <small>{order.inventoryIssue}</small>}
            {order.refundedPaise ? <small>Refunded so far: {money(order.refundedPaise)} · In progress: {money(order.refundsInFlightPaise ?? 0)}</small> : null}
            {Array.isArray(order.refunds) && order.refunds.length > 0 && <div className="admin-refund-history">{order.refunds.map((refund) => <small key={refund.refundId}>Refund {refund.refundId}: {money(refund.amountPaise)} · {refund.status}</small>)}</div>}
            <small>Customer UID: {order.userId}</small>
            {order.paymentMode === "test" && order.paymentStatus === "paid" && (
              <div className="admin-shipment-editor">
                <p className="admin-shipment-heading">TEST ORDER STATUS EMAIL</p>
                <small>Sends a sample notification to the email saved on this test order. It does not change the order status, stock, courier details or shipment.</small>
                <label>PREVIEW STATUS
                  <select
                    value={testStatusDrafts[order.id] ?? "processing"}
                    onChange={(event) => setTestStatusDrafts((current) => ({
                      ...current,
                      [order.id]: event.target.value as "processing" | "shipped" | "delivered",
                    }))}
                  >
                    <option value="processing">Processing</option>
                    <option value="shipped">Shipped</option>
                    <option value="delivered">Delivered</option>
                  </select>
                </label>
                <button className="admin-row-button" disabled={busy} onClick={() => void sendTestStatusEmail(order, testStatusDrafts[order.id] ?? "processing")}>
                  SEND SAMPLE STATUS EMAIL
                </button>
                <button className="admin-row-button" disabled={busy} onClick={() => void sendTestTrackingEmail(order)}>
                  SEND SAMPLE TRACKING EMAIL
                </button>
                <small>Uses a demo courier, demo AWB and example.com tracking link. No real courier booking, AWB assignment, pickup or dispatch is performed.</small>
              </div>
            )}
            {order.paymentId && ["paid", "partially_refunded"].includes(order.paymentStatus) && (
              <div className="admin-shipment-editor admin-refund-editor">
                <p className="admin-shipment-heading">REFUND PAYMENT</p>
                <small>Remaining refundable: {money(Math.max(0, order.totalPaise - (order.refundedPaise ?? 0) - (order.refundsInFlightPaise ?? 0)))}</small>
                <label>REFUND AMOUNT IN RUPEES (LEAVE BLANK FOR FULL REMAINING)
                  <input type="number" min="1" step="0.01" value={refundDrafts[order.id] ?? ""} placeholder={money(Math.max(0, order.totalPaise - (order.refundedPaise ?? 0) - (order.refundsInFlightPaise ?? 0)))} onChange={(event) => {
                    const value = event.target.value;
                    const amountPaise = value.trim() ? Math.round(Number(value) * 100) : undefined;
                    setRefundDrafts((current) => ({ ...current, [order.id]: value }));
                    setRefundKeys((current) => {
                      if (!current[order.id] || current[order.id].amountPaise === amountPaise) return current;
                      const next = { ...current }; delete next[order.id]; return next;
                    });
                  }} />
                </label>
                <button className="admin-row-button" disabled={busy || Number(refundDrafts[order.id] ?? 0) < 0} onClick={() => {
                  const amountPaise = refundDrafts[order.id]?.trim() ? Math.round(Number(refundDrafts[order.id]) * 100) : undefined;
                  const existing = refundKeys[order.id];
                  const key = existing && existing.amountPaise === amountPaise ? existing.key : crypto.randomUUID();
                  setRefundKeys((current) => ({ ...current, [order.id]: { key, amountPaise } }));
                  void refundOrder(order, amountPaise, key).then((ok) => {
                    if (ok) setRefundKeys((current) => { const next = { ...current }; delete next[order.id]; return next; });
                  });
                }}>
                  INITIATE REFUND
                </button>
                <small>Test payments create simulated refunds. Live refunds require live API credentials and a separately enabled server flag.</small>
              </div>
            )}
            {order.shiprocketStatus && <small>Shiprocket: {order.shiprocketStatus}</small>}
            {order.shiprocketOrderId && <small>Courier draft ID: {order.shiprocketOrderId} · Shipment: {order.shiprocketShipmentId ?? "Pending"}</small>}
            {order.shiprocketDraftState === "needs_review" && <small>Shiprocket draft needs manual reconciliation before retrying.</small>}
            {order.paymentMode !== "test" && order.paymentStatus === "paid" && !order.demoOrder && !order.shiprocketOrderId && order.shiprocketDraftState !== "needs_review" && (
              <div className="admin-shipment-editor">
                <p className="admin-shipment-heading">SHIPROCKET DRAFT</p>
                <small>This creates the courier order only. AWB assignment and pickup remain manual.</small>
                <button className="admin-row-button" disabled={busy || order.shiprocketDraftState === "creating"} onClick={() => void createCourierDraft(order)}>
                  {order.shiprocketDraftState === "creating" ? "CREATING DRAFT…" : "CREATE SHIPROCKET DRAFT"}
                </button>
              </div>
            )}
            {order.carrier && <small>Courier: {order.carrier}</small>}
            {order.trackingNumber && <small>Tracking number: {order.trackingNumber}</small>}
            {canManageShipment && (
              <div className="admin-shipment-editor">
                <p className="admin-shipment-heading">{order.status === "shipped" ? "COURIER TRACKING" : "SHIPMENT DETAILS"}</p>
                <label>COURIER / DELIVERY PARTNER
                  <input value={shipment.carrier} maxLength={80} placeholder="e.g. Delhivery, Blue Dart" onChange={(event) => setShipmentField(order, "carrier", event.target.value)} />
                </label>
                <label>TRACKING / AWB NUMBER
                  <input value={shipment.trackingNumber} maxLength={120} placeholder="Enter courier tracking number" onChange={(event) => setShipmentField(order, "trackingNumber", event.target.value)} />
                </label>
                <label>TRACKING LINK (OPTIONAL)
                  <input type="url" value={shipment.trackingUrl} maxLength={500} placeholder="https://courier.example/track/…" onChange={(event) => setShipmentField(order, "trackingUrl", event.target.value)} />
                </label>
                <button className="admin-row-button" disabled={busy || !shipment.carrier.trim() || !shipment.trackingNumber.trim()} onClick={() => void updateOrder(order, "shipped", shipment)}>
                  {order.status === "shipped" ? "SAVE TRACKING DETAILS" : "SAVE DETAILS & MARK SHIPPED"}
                </button>
              </div>
            )}
          </div>
        </details>
      </td>
      <td>{dateLabel(order.createdAt)}</td>
      <td>{money(order.totalPaise)}</td>
      <td><span className={`admin-pill ${order.paymentStatus === "paid" && order.paymentMode !== "test" ? "green" : "muted"}`}>{order.paymentMode === "test" ? (order.paymentStatus === "paid" ? "TEST PAID" : `TEST ${order.paymentStatus.toUpperCase()}`) : order.paymentStatus.toUpperCase()}</span></td>
      <td><span className="admin-pill muted">{order.status}</span></td>
      <td>{nextStatus ? <button className="admin-row-button" disabled={busy} onClick={() => void updateOrder(order, nextStatus)}>Mark {nextStatus}</button> : <span className="admin-dash">—</span>}</td>
    </tr>;
  })}</tbody></table>{orders.length === 0 && <EmptyState>No order records exist yet. Orders and sales will appear after launch when customer orders are enabled.</EmptyState>}</div>;
}
