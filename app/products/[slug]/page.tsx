"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AccountMenu } from "@/components/auth/account-menu";
import { ShippingChecker } from "@/components/store/shipping-checker";
import { useAuth } from "@/components/auth/auth-provider";
import { mergeGuestCartIntoCloud, saveCloudCartItem, subscribeToCloudCart } from "@/lib/firebase/cart";
import type { CartQuantities } from "@/lib/firebase/cart";
import { subscribeToPublishedProducts } from "@/lib/firebase/catalogue";
import type { Product } from "@/lib/products";

const isDemoCatalogueMode = process.env.NEXT_PUBLIC_CATALOGUE_DEMO_MODE === "true";

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}

function readGuestCart(): CartQuantities {
  try {
    const raw = window.localStorage.getItem("pokhars-cart-v1");
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const safe: CartQuantities = {};
    for (const [id, quantity] of Object.entries(parsed)) {
      if (Number.isInteger(quantity) && (quantity as number) > 0) safe[id] = Math.min(Number(quantity), 20);
    }
    return safe;
  } catch {
    window.localStorage.removeItem("pokhars-cart-v1");
    return {};
  }
}

function publicDescription(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (/(we can initially use|proposed mrp|for discussion|confirming margins|illustrative draft)/i.test(text)) return null;
  return text;
}

export default function ProductDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { user, loading: authLoading } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogueReady, setCatalogueReady] = useState(false);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [cartReady, setCartReady] = useState(false);
  const [cartQuantity, setCartQuantity] = useState(0);
  const [cartError, setCartError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribeToPublishedProducts(
        (next) => {
          if (!active) return;
          setProducts(next);
          setCatalogueReady(true);
          setCatalogueError(null);
        },
        (cause) => {
          if (!active) return;
          setCatalogueReady(true);
          setCatalogueError(cause.message || "The product catalogue could not be loaded.");
        },
      );
    } catch (cause) {
      setCatalogueReady(true);
      setCatalogueError(cause instanceof Error ? cause.message : "The product catalogue could not be loaded.");
    }
    return () => { active = false; unsubscribe?.(); };
  }, []);

  const product = useMemo(
    () => products.find((item) => item.id === slug || item.slug === slug),
    [products, slug],
  );
  const recommendations = useMemo(() => {
    if (!product) return [];
    return products
      .filter((item) => item.id !== product.id)
      .sort((a, b) => Number(b.category === product.category) - Number(a.category === product.category))
      .slice(0, 4);
  }, [products, product]);

  useEffect(() => {
    setImageFailed(false);
    setFeedback(null);
  }, [product?.id]);

  useEffect(() => {
    if (!product?.id || authLoading) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setCartReady(false);
    setCartError(null);

    if (!user) {
      const guest = readGuestCart();
      setCartQuantity(guest[product.id] ?? 0);
      setCartReady(true);
      return () => { active = false; };
    }

    void (async () => {
      try {
        await mergeGuestCartIntoCloud(user.uid, readGuestCart());
        if (!active) return;
        window.localStorage.removeItem("pokhars-cart-v1");
        unsubscribe = subscribeToCloudCart(
          user.uid,
          (cart) => {
            if (!active) return;
            setCartQuantity(cart[product.id] ?? 0);
            setCartReady(true);
            setCartError(null);
          },
          (cause) => {
            if (!active) return;
            setCartError(cause.message || "Your bag could not be synced.");
            setCartReady(true);
          },
        );
      } catch (cause) {
        if (!active) return;
        setCartError(cause instanceof Error ? cause.message : "Your bag could not be synced.");
        setCartReady(true);
      }
    })();

    return () => { active = false; unsubscribe?.(); };
  }, [product?.id, authLoading, user]);

  async function addToBag() {
    if (!product || !cartReady) return;
    setAdding(true);
    setCartError(null);
    setFeedback(null);
    try {
      if (cartQuantity >= 20) throw new Error("Maximum 20 packs of this flavour can be added.");
      const nextQuantity = cartQuantity + 1;
      if (user) {
        await saveCloudCartItem(user.uid, product.id, nextQuantity);
      } else {
        const guest = readGuestCart();
        guest[product.id] = nextQuantity;
        window.localStorage.setItem("pokhars-cart-v1", JSON.stringify(guest));
      }
      setCartQuantity(nextQuantity);
      setFeedback("Added to your bag.");
    } catch (cause) {
      setCartError(cause instanceof Error ? cause.message : "This product could not be added to your bag.");
    } finally {
      setAdding(false);
    }
  }

  const detailSections = product ? [
    ["INGREDIENTS", product.ingredients],
    ["ALLERGEN INFORMATION", product.allergenInfo],
    ["NUTRITION INFORMATION", product.nutritionInfo],
    ["STORAGE INSTRUCTIONS", product.storageInstructions],
    ["SHELF LIFE", product.shelfLife],
  ].filter((item): item is [string, string] => Boolean(item[1]?.trim())) : [];

  const packFacts = product ? [
    ["FLAVOUR", product.flavour],
    ["NET WEIGHT", product.weight],
    ["SKU", product.sku],
    ["COUNTRY OF ORIGIN", product.countryOfOrigin],
    ["MANUFACTURER / PACKER", product.manufacturerName],
    ["MANUFACTURER ADDRESS", product.manufacturerAddress],
    ["FSSAI LICENCE", product.fssaiLicenseNumber],
  ].filter((item): item is [string, string] => Boolean(item[1]?.trim())) : [];

  if (!catalogueReady) {
    return <main className="product-detail-shell"><div className="announcement"><span>MADE IN BIHAR</span><b>✳</b><span>SNACK HAPPY</span></div><div className="product-detail-empty"><h1>Opening the flavour jar…</h1><p>Loading the latest POKHAR’S product details.</p></div></main>;
  }

  if (!product) {
    return (
      <main className="product-detail-shell">
        <div className="announcement"><span>MADE IN BIHAR</span><b>✳</b><span>SNACK HAPPY</span></div>
        <div className="product-detail-empty">
          <h1>{catalogueError ? "Product details unavailable" : "Flavour not found"}</h1>
          <p>{catalogueError || "This product may have been hidden or unpublished. Explore the current POKHAR’S flavour collection."}</p>
          <Link className="product-detail-back" href="/#flavours">BACK TO ALL FLAVOURS</Link>
        </div>
      </main>
    );
  }

  const description = publicDescription(product.note);
  return (
    <main className="product-detail-shell">
      <div className="announcement"><span>MADE IN BIHAR</span><b>✳</b><span>BIG CRUNCH ENERGY</span><b>✳</b><span>SNACK HAPPY</span></div>
      <header className="site-header product-detail-header">
        <Link className="brand" href="/" aria-label="POKHAR’S home">
          <span className="brand-mark">P</span><span className="brand-word">POKHAR’S</span><span className="brand-sub">MAKHANA WITH A MOOD</span>
        </Link>
        <nav className="main-nav product-detail-nav">
          <Link href="/#flavours">FLAVOURS</Link><Link href="/#story">OUR STORY</Link><Link href="/#heritage">MITHILA VIBES</Link>
        </nav>
        <AccountMenu />
        <Link className="product-detail-bag" href="/?openBag=1">{isDemoCatalogueMode ? "DEMO BAG ↗" : "YOUR BAG ↗"}</Link>
      </header>

      {isDemoCatalogueMode && <div className="demo-store-banner product-demo-banner" role="note"><strong>DEMO PRODUCT · NOT FOR SALE</strong><span>This is a sample listing for website development. Product image, price and food-label details are illustrative, not a final retail offer or approved food label.</span></div>}
      <section className="product-detail-main">
        <p className="product-breadcrumb"><Link href="/">HOME</Link><span> / </span><Link href="/#flavours">FLAVOURS</Link><span> / </span><strong>{product.name.toUpperCase()}</strong></p>
        <div className="product-detail-grid">
          <div className="product-detail-media" style={{ "--flavour": product.accent } as React.CSSProperties}>
            {(isDemoCatalogueMode || product.tag) && <span className="product-detail-tag" style={{ position: "absolute", top: 22, left: 22 }}>{isDemoCatalogueMode ? "DEMO · NOT FOR SALE" : product.tag}</span>}
            {product.imageUrl && !imageFailed ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img className="product-detail-image" src={product.imageUrl} alt={product.name + " packaging"} onError={() => setImageFailed(true)} />
            ) : (
              <div className="product-detail-fallback">
                <strong>POKHAR’S</strong><span>{product.name}</span><small>{product.weight}</small>
              </div>
            )}
          </div>

          <div className="product-detail-info">
            <span className="product-detail-tag">{product.category.toUpperCase()} · ROASTED MAKHANA</span>
            <h1>{product.name}</h1>
            <p className="product-detail-flavour">{product.flavour}</p>
            <p className="product-detail-summary">
              {description || "Product description is being updated. The verified ingredients and pack information are shown below."}
            </p>

            <div className="product-detail-pricing">
              <strong>{money(product.price)}</strong>
              {product.mrp && product.mrp > product.price && <del>{money(product.mrp)}</del>}
            </div>
            <div className="product-detail-meta">
              <span>{product.weight}</span><span>{product.category}</span>{product.sku && <span>SKU · {product.sku}</span>}
            </div>

            <ShippingChecker subtotalPaise={Math.round(product.price * 100)} weightGrams={Number(product.weightGrams) || 0} />
            <button className="product-detail-add" type="button" disabled={!cartReady || adding || cartQuantity >= 20} onClick={() => void addToBag()}>
              {adding ? "ADDING…" : cartQuantity >= 20 ? "MAXIMUM QUANTITY ADDED" : isDemoCatalogueMode ? "ADD TO DEMO BAG" : "ADD TO YOUR BAG"} <b>↗</b>
            </button>
            {feedback && <p className="product-detail-feedback" role="status">{feedback}</p>}
            {feedback && <Link className="product-detail-viewbag" href="/?openBag=1">VIEW YOUR BAG ↗</Link>}
            {cartError && <p className="product-detail-feedback" role="alert">{cartError}</p>}
            {!cartReady && <p className="product-detail-feedback">Preparing your saved bag…</p>}

            <div className="product-detail-facts">
              {packFacts.filter(([label]) => label !== "FLAVOUR").map(([label, value]) => (
                <div className="product-detail-fact" key={label}><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {detailSections.length > 0 && (
        <section className="product-detail-sections" aria-label="Product ingredients and pack details">
          {detailSections.map(([heading, value]) => (
            <article className="product-detail-section" key={heading}><h2>{heading}</h2><p>{value}</p></article>
          ))}
        </section>
      )}

      <section className="product-detail-related">
        <div className="product-detail-related-heading">
          <div><p className="section-kicker">MORE TO LOVE</p><h2>You may also like</h2></div>
          <Link href="/#flavours" className="story-link">ALL FLAVOURS ↗</Link>
        </div>
        {recommendations.length > 0 ? (
          <div className="product-detail-related-grid">
            {recommendations.map((item) => (
              <Link className="product-related-card" href={"/products/" + encodeURIComponent(item.slug || item.id)} key={item.id}>
                <div className="product-related-image">
                  {item.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={item.imageUrl} alt={item.name} loading="lazy" />
                  ) : <div className="product-pack" style={{ "--flavour": item.accent, "--flavour-ink": item.ink } as React.CSSProperties}><div className="pack-brand">POKHAR’S</div><div className="pack-name">{item.name}</div></div>}
                </div>
                <h3 className="product-related-name">{item.name}</h3>
                <p className="product-related-meta">{item.flavour} · {item.weight}</p>
                <div className="product-related-price"><span>{money(item.price)}</span><span>VIEW ↗</span></div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="product-detail-empty product-detail-empty-related">
            <h1>More flavours are on the way.</h1>
            <p>As soon as other approved POKHAR’S flavours are published, you’ll find them here.</p>
          </div>
        )}
      </section>
    </main>
  );
}
