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
  id: string; orderNumber?: string; userId: string; items?: Array<{ nameSnapshot: string; quantity: number; lineTotalPaise: number }>;
  totalPaise: number; status: string; paymentStatus: string; paymentMode?: string; inventoryIssue?: string; createdAt?: unknown;
};
type Coupon = { id: string; code: string; discountType: "percent" | "fixed"; discountValue: number; isActive: boolean };
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
      if (key === "fssaiLicenseNumber") return !/^[12]\\d{13}$/.test(String(product.fssaiLicenseNumber ?? "").trim());
      const value = product[key];
      if (typeof value !== "string" || !value.trim()) return true;
      const normalized = value.trim().toLowerCase().replace(/[.,:;!?]+/g, "").replace(/\\s+/g, " ");
      return ["exact ingredient list", "verified allergen declaration", "verified nutrition information", "legal business name and address", "actual licence number", "actual license number"].includes(normalized)
        || /^(enter|add|insert|replace with|to be confirmed|tbd|todo)\\b/i.test(normalized);
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
  const [tab, setTab] = useState<"overview" | "products" | "inventory" | "orders" | "coupons">("overview");
  const [productForm, setProductForm] = useState<ProductForm>(blankProduct);
  const [editing, setEditing] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [couponType, setCouponType] = useState<"percent" | "fixed">("percent");
  const [couponValue, setCouponValue] = useState(10);
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
      const [nextProducts, nextOrders, nextCoupons] = await Promise.all([
        api("/api/admin/products"), api("/api/admin/orders"), api("/api/admin/coupons"),
      ]);
      setProducts(nextProducts); setOrders(nextOrders); setCoupons(nextCoupons);
    } catch (cause) {
      setAuthorized(false);
      setError(cause instanceof Error ? cause.message : "Admin data could not be loaded.");
    } finally { setChecking(false); }
  }, [api]);

  useEffect(() => { if (!loading && user) void loadData(); else if (!user) setAuthorized(false); }, [loading, user, loadData]);

  const lowStock = products.filter((product) => product.stockQuantity <= 5);
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
      const baseName = (productForm.name.trim() || file.name.replace(/\\.[^.]+$/, ""))
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

  async function updateOrder(order: AdminOrder, status: string) {
    setBusy(true); setError(null);
    try { await api(`/api/admin/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); setNotice(`Order ${order.orderNumber ?? order.id} updated.`); await loadData(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Order status could not be updated."); }
    finally { setBusy(false); }
  }

  async function createCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try {
      await api("/api/admin/coupons", { method: "POST", body: JSON.stringify({ code: couponCode.toUpperCase(), discountType: couponType, discountValue: couponValue, isActive: false }) });
      setCouponCode(""); setNotice("Coupon created inactive. Activate it when your checkout supports coupons."); await loadData();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Coupon could not be saved."); }
    finally { setBusy(false); }
  }

  async function deactivateCoupon(coupon: Coupon) {
    setBusy(true); setError(null);
    try { await api(`/api/admin/coupons/${coupon.id}`, { method: "PATCH", body: JSON.stringify({ ...coupon, isActive: false }) }); setNotice("Coupon deactivated."); await loadData(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Coupon could not be updated."); }
    finally { setBusy(false); }
  }

  const tabs = useMemo(() => [
    ["overview", "Overview"], ["products", "Products"], ["inventory", `Inventory${lowStock.length ? ` · ${lowStock.length}` : ""}`], ["orders", "Orders"], ["coupons", "Coupons"],
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
        {isDemoCatalogueMode && <div className="admin-alert warning admin-demo-notice" role="status"><strong>DEMO CATALOGUE MODE · NOT FOR SALE</strong><span>Sample product names, images, prices and food-label details are allowed for website development. Test the admin and storefront freely; all checkout and payments are disabled.</span></div>}
        {error && <div className="admin-alert error" role="alert">{error}</div>}{notice && <div className="admin-alert success" role="status">{notice}</div>}
        {tab === "overview" && <>
          <div className="admin-metrics">
            <article><span>LIVE PAID REVENUE · LOADED ORDERS</span><strong>{money(revenue)}</strong><small>From {paidCount} live order{paidCount === 1 ? "" : "s"} marked paid</small></article>
            <article><span>LIVE PAID ORDERS</span><strong>{paidCount}</strong><small>{orders.length} actual order records loaded; test orders excluded</small></article>
            <article><span>PUBLISHED PRODUCTS</span><strong>{activeProducts}</strong><small>Active and visible in the storefront</small></article>
            <article className={lowStock.length ? "attention" : ""}><span>LOW STOCK · 5 OR FEWER</span><strong>{lowStock.length}</strong><small>{lowStock.length ? "Review inventory" : "All products above alert level"}</small></article>
          </div>
          <section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">LATEST ACTIVITY</p><h2>Recent orders</h2></div><button className="admin-link-button" onClick={() => setTab("orders")}>View all →</button></div><OrderTable orders={orders.slice(0, 5)} busy={busy} updateOrder={updateOrder} /></section>
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
        {tab === "orders" && <section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">CUSTOMER ORDERS</p><h2>Orders</h2></div><span className="admin-pill muted">Latest 200</span></div><OrderTable orders={orders} busy={busy} updateOrder={updateOrder} /></section>}
        {tab === "coupons" && <div className="admin-products-layout"><section className="admin-panel admin-form-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">PROMOTIONS</p><h2>Create coupon</h2></div></div><div className="admin-alert warning">Coupons are stored for admin management. Checkout does not validate or apply them yet, so new codes start inactive and cannot be activated here.</div><form className="admin-form" onSubmit={createCoupon}><label>Coupon code<input required minLength={3} maxLength={32} value={couponCode} onChange={(e) => setCouponCode(e.target.value.replace(/[^a-z0-9_-]/gi, "").toUpperCase())} /></label><label>Discount type<select value={couponType} onChange={(e) => setCouponType(e.target.value as "percent" | "fixed")}><option value="percent">Percentage</option><option value="fixed">Fixed amount (paise)</option></select></label><label>Discount value<input required type="number" min="1" max={couponType === "percent" ? 100 : undefined} step="1" value={couponValue} onChange={(e) => setCouponValue(Number(e.target.value))} /><small>Fixed amounts are entered in paise until checkout rules are defined.</small></label><button className="admin-primary" disabled={busy}>Create inactive coupon</button></form></section><section className="admin-panel"><div className="admin-panel-heading"><div><p className="admin-eyebrow">{coupons.length} TOTAL</p><h2>Coupons</h2></div></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Code</th><th>Discount</th><th>Status</th><th /></tr></thead><tbody>{coupons.map((coupon) => <tr key={coupon.id}><td><strong>{coupon.code}</strong></td><td>{coupon.discountType === "percent" ? `${coupon.discountValue}%` : money(coupon.discountValue)}</td><td><span className={`admin-pill ${coupon.isActive ? "green" : "muted"}`}>{coupon.isActive ? "active" : "inactive"}</span></td><td>{coupon.isActive ? <button className="admin-row-button" onClick={() => void deactivateCoupon(coupon)} disabled={busy}>Deactivate</button> : <span className="admin-dash">Activation pending checkout</span>}</td></tr>)}</tbody></table>{coupons.length === 0 && <EmptyState>No coupon documents were found.</EmptyState>}</div></section></div>}
      </section>
    </main>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) { return <div className="admin-empty">{children}</div>; }

function OrderTable({ orders, busy, updateOrder }: { orders: AdminOrder[]; busy: boolean; updateOrder: (order: AdminOrder, status: string) => Promise<void> }) {
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Order</th><th>Date</th><th>Total</th><th>Payment</th><th>Status</th><th>Update</th></tr></thead><tbody>{orders.map((order) => {
    const nextStatus = order.paymentMode !== "test" && !order.inventoryIssue && order.paymentStatus === "paid" ? order.status === "confirmed" ? "processing" : order.status === "processing" ? "shipped" : order.status === "shipped" ? "delivered" : "" : "";
    return <tr key={order.id}><td><strong>{order.orderNumber || order.id.slice(0, 10)}</strong>{order.paymentMode === "test" && <span className="admin-pill muted">TEST</span>}{order.inventoryIssue && <span className="admin-pill muted">INVENTORY REVIEW</span>}<details className="admin-order-detail"><summary>{order.items?.length ?? 0} line items · Details</summary><div>{order.items?.length ? order.items.map((item, index) => <p key={`${item.nameSnapshot}-${index}`}>{item.nameSnapshot} × {item.quantity} <b>{money(item.lineTotalPaise)}</b></p>) : <p>No item snapshot recorded.</p>}{order.inventoryIssue && <small>{order.inventoryIssue}</small>}<small>Customer UID: {order.userId}</small></div></details></td><td>{dateLabel(order.createdAt)}</td><td>{money(order.totalPaise)}</td><td><span className={`admin-pill ${order.paymentStatus === "paid" && order.paymentMode !== "test" ? "green" : "muted"}`}>{order.paymentMode === "test" ? "test paid" : order.paymentStatus}</span></td><td><span className="admin-pill muted">{order.status}</span></td><td>{nextStatus ? <button className="admin-row-button" disabled={busy} onClick={() => void updateOrder(order, nextStatus)}>Mark {nextStatus}</button> : <span className="admin-dash">—</span>}</td></tr>;
  })}</tbody></table>{orders.length === 0 && <EmptyState>No order records exist yet. Orders and sales will appear when a secure order backend is added.</EmptyState>}</div>;
}
