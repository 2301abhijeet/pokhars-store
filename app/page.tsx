"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/lib/products";
import { subscribeToPublishedProducts } from "@/lib/firebase/catalogue";
import { AccountMenu } from "@/components/auth/account-menu";
import { useAuth } from "@/components/auth/auth-provider";
import { subscribeToCustomerAddresses, type CustomerAddress } from "@/lib/firebase/addresses";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {
  mergeGuestCartIntoCloud,
  saveCloudCartItem,
  subscribeToCloudCart,
  type CartQuantities,
} from "@/lib/firebase/cart";

type Filter = "All" | "Classic" | "Masala" | "Fresh" | "Cheesy" | "Premium";
type Cart = CartQuantities;
type CheckoutConfig = { enabled: boolean; mode: "test" | null; keyId: string; shippingPaise: number; livePaymentsEnabled: false };
type RazorpayPaymentResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type PendingPayment = { orderId: string; response: RazorpayPaymentResponse };
type RazorpayOptions = {
  key: string; amount: number; currency: string; name: string; description: string; order_id: string;
  prefill: { name: string; email: string; contact: string };
  theme: { color: string };
  handler: (response: RazorpayPaymentResponse) => void | Promise<void>;
  modal: { ondismiss: () => void };
};
type RazorpayInstance = { open: () => void; on: (event: string, callback: (event: { error?: { description?: string } }) => void) => void };

function loadRazorpayCheckout(): Promise<boolean> {
  const razorpayWindow = window as typeof window & { Razorpay?: new (options: RazorpayOptions) => RazorpayInstance };
  if (razorpayWindow.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.getElementById("razorpay-checkout-script") as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    script.id = "razorpay-checkout-script";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(Boolean(razorpayWindow.Razorpay));
    script.onerror = () => resolve(false);
    if (!existing) document.body.appendChild(script);
  });
}

const filters: Filter[] = ["All", "Classic", "Masala", "Fresh", "Cheesy", "Premium"];
const dayNames = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPricePaise(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export default function HomePage() {
  const [filter, setFilter] = useState<Filter>("All");
  const [cart, setCart] = useState<Cart>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [cartReady, setCartReady] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [firestoreProducts, setFirestoreProducts] = useState<Product[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [cloudCartReady, setCloudCartReady] = useState(false);
  const [cartSyncError, setCartSyncError] = useState<string | null>(null);
  const { user, loading: authLoading, signInWithGoogle } = useAuth();
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [checkoutConfig, setCheckoutConfig] = useState<CheckoutConfig | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const cartRef = useRef<Cart>({});
  cartRef.current = cart;

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = subscribeToPublishedProducts(
        (nextProducts) => {
          setFirestoreProducts(nextProducts);
          setCatalogueError(null);
        },
        (cause) => setCatalogueError(cause.message || "Live product catalogue could not be loaded."),
      );
    } catch (cause) {
      setCatalogueError(cause instanceof Error ? cause.message : "Live product catalogue could not be loaded.");
    }
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("pokhars-cart-v1");
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setCart(parsed as Cart);
        }
      }
    } catch {
      window.localStorage.removeItem("pokhars-cart-v1");
    }
    setCartReady(true);
  }, []);

  // Keep guest carts on this device. Once authenticated, Firestore is the source of truth.
  useEffect(() => {
    if (cartReady && !authLoading && !user) {
      window.localStorage.setItem("pokhars-cart-v1", JSON.stringify(cart));
    }
  }, [cart, cartReady, authLoading, user]);

  // Merge any guest cart into the customer's cloud cart, then subscribe to
  // Firestore so updates made on another signed-in device appear here too.
  useEffect(() => {
    if (!cartReady || authLoading) return;

    if (!user) {
      setCloudCartReady(false);
      setCartSyncError(null);
      return;
    }

    let active = true;
    let unsubscribe: (() => void) | null = null;
    setCloudCartReady(false);
    setCartSyncError(null);

    void (async () => {
      try {
        const guestCart = cartRef.current;
        await mergeGuestCartIntoCloud(user.uid, guestCart);
        if (!active) return;

        window.localStorage.removeItem("pokhars-cart-v1");
        unsubscribe = subscribeToCloudCart(
          user.uid,
          (nextCart) => {
            if (!active) return;
            setCart(nextCart);
            setCloudCartReady(true);
            setCartSyncError(null);
          },
          (cause) => {
            if (!active) return;
            setCartSyncError(cause.message || "Your cloud cart could not be loaded.");
          },
        );
      } catch (cause) {
        if (!active) return;
        setCartSyncError(
          cause instanceof Error ? cause.message : "Your cloud cart could not be synced.",
        );
      }
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [cartReady, authLoading, user]);

  useEffect(() => {
    if (!cartOpen || !user) {
      setSavedAddresses([]);
      setSelectedAddressId("");
      return;
    }
    let active = true;
    try {
      const unsubscribe = subscribeToCustomerAddresses(user.uid, (addresses) => {
        if (!active) return;
        setSavedAddresses(addresses);
        setSelectedAddressId((current) => current && addresses.some((address) => address.id === current)
          ? current
          : addresses.find((address) => address.isDefault)?.id ?? addresses[0]?.id ?? "");
      }, (cause) => {
        if (active) setCheckoutError(cause.message || "Saved delivery addresses could not be loaded.");
      });
      return () => { active = false; unsubscribe(); };
    } catch (cause) {
      setCheckoutError(cause instanceof Error ? cause.message : "Saved delivery addresses could not be loaded.");
    }
    return () => { active = false; };
  }, [cartOpen, user]);

  useEffect(() => {
    if (!cartOpen || !user) return;
    let active = true;
    void fetch("/api/checkout/config", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Checkout settings could not be loaded.");
        return response.json() as Promise<CheckoutConfig>;
      })
      .then((config) => { if (active) setCheckoutConfig(config); })
      .catch((cause: unknown) => {
        if (active) setCheckoutError(cause instanceof Error ? cause.message : "Checkout settings could not be loaded.");
      });
    return () => { active = false; };
  }, [cartOpen, user]);

  // Only products with complete, verified publish details are returned by the
  // Firestore catalogue. Never fall back to demonstration SKUs in production.
  const catalogueProducts = firestoreProducts;
  const hasLiveCatalogue = firestoreProducts.length > 0;
  const catalogueMessage = hasLiveCatalogue
    ? "LIVE CATALOGUE · FIRESTORE CONNECTED"
    : catalogueError
      ? "LIVE CATALOGUE TEMPORARILY UNAVAILABLE"
      : "OUR APPROVED FLAVOUR CATALOGUE IS BEING PREPARED";

  const visibleProducts = useMemo(
    () => filter === "All" ? catalogueProducts : catalogueProducts.filter((product) => product.category === filter),
    [filter, catalogueProducts],
  );
  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const cartItems = catalogueProducts.filter((product) => (cart[product.id] ?? 0) > 0);
  const subtotal = cartItems.reduce(
    (sum, product) => sum + product.price * (cart[product.id] ?? 0),
    0,
  );
  const cartIsBusy = Boolean(user) && !cloudCartReady;

  function commitCartChange(next: Cart) {
    const previous = cartRef.current;
    cartRef.current = next;
    setCart(next);

    if (user && cloudCartReady) {
      setCartSyncError(null);
      for (const productId of Object.keys(previous)) {
        if (!(productId in next)) {
          void saveCloudCartItem(user.uid, productId, 0).catch((cause: unknown) => {
            setCartSyncError(cause instanceof Error ? cause.message : "Cart update failed.");
          });
        }
      }
      for (const [productId, quantity] of Object.entries(next)) {
        if (previous[productId] !== quantity) {
          void saveCloudCartItem(user.uid, productId, quantity).catch((cause: unknown) => {
            setCartSyncError(cause instanceof Error ? cause.message : "Cart update failed.");
          });
        }
      }
    }
  }

  function addToCart(id: string) {
    const current = cartRef.current;
    const quantity = current[id] ?? 0;
    if (quantity >= 20) {
      setCartSyncError("Maximum 20 packs per flavour can be added to the bag.");
      setCartOpen(true);
      return;
    }
    commitCartChange({ ...current, [id]: quantity + 1 });
    setCartOpen(true);
  }

  function changeQuantity(id: string, amount: number) {
    const next = { ...cartRef.current };
    const quantity = (next[id] ?? 0) + amount;
    if (quantity <= 0) delete next[id];
    else next[id] = Math.min(quantity, 20);
    commitCartChange(next);
  }

  async function verifyPayment(orderId: string, response: RazorpayPaymentResponse) {
    if (!user) throw new Error("Sign in again to verify this payment.");
    const token = await user.getIdToken();
    const result = await fetch("/api/checkout/verify-payment", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ orderId, ...response }),
    });
    const payload = await result.json().catch(() => ({})) as { status?: string; message?: string; orderNumber?: string; error?: string };
    if (payload.status === "paid") {
      setPendingPayment(null);
      setCheckoutMessage(`Test payment confirmed for ${payload.orderNumber || "your order"}. No real payment was taken.`);
      setCheckoutError(null);
      commitCartChange({});
      return;
    }
    if (payload.status === "processing") {
      setCheckoutMessage(payload.message || "Payment is still processing. Check again in a moment.");
      return;
    }
    if (payload.status === "failed") {
      setPendingPayment(null);
      setCheckoutMessage(null);
      throw new Error(payload.message || "The test payment failed. You can try again.");
    }
    if (!result.ok) throw new Error(payload.message || payload.error || "Payment could not be verified yet. Please check again.");
    throw new Error(payload.message || "Test payment did not complete.");
  }

  async function startCheckout() {
    setCheckoutError(null);
    setCheckoutMessage(null);
    if (!user) {
      try { await signInWithGoogle(); } catch (cause) {
        setCheckoutError(cause instanceof Error ? cause.message : "Please sign in to continue.");
      }
      return;
    }
    if (!checkoutConfig?.enabled || checkoutConfig.mode !== "test") {
      setCheckoutError("Test checkout is not configured yet. Live payments are disabled.");
      return;
    }
    if (!hasLiveCatalogue || !selectedAddressId || cartItems.length === 0) {
      setCheckoutError("Choose a saved address and make sure the live catalogue is available.");
      return;
    }
    const auth = getFirebaseAuth();
    if (!auth) {
      setCheckoutError("Sign-in is not available right now.");
      return;
    }
    setCheckoutBusy(true);
    try {
      const token = await user.getIdToken();
      const created = await fetch("/api/checkout/orders", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          addressId: selectedAddressId,
          requestId: crypto.randomUUID(),
          items: cartItems.map((product) => ({ productId: product.id, quantity: cart[product.id] })),
        }),
      });
      const order = await created.json().catch(() => ({})) as {
        orderId?: string; orderNumber?: string; razorpayOrderId?: string; amount?: number; currency?: string; keyId?: string; error?: string;
      };
      if (!created.ok || !order.orderId || !order.razorpayOrderId || !order.keyId || !order.amount) {
        throw new Error(order.error || "A test order could not be created. Refresh your bag and try again.");
      }
      const loaded = await loadRazorpayCheckout();
      const razorpayWindow = window as typeof window & { Razorpay?: new (options: RazorpayOptions) => RazorpayInstance };
      if (!loaded || !razorpayWindow.Razorpay) throw new Error("The test payment window could not be loaded. Your reserved stock will be released automatically after 30 minutes.");
      const address = savedAddresses.find((item) => item.id === selectedAddressId)!;
      const checkout = new razorpayWindow.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency || "INR",
        name: "POKHAR'S",
        description: "Test checkout · no real charge",
        order_id: order.razorpayOrderId,
        prefill: { name: address.recipientName, email: user.email || "", contact: address.phone },
        theme: { color: "#ffd45a" },
        handler: async (response) => {
          setPendingPayment({ orderId: order.orderId!, response });
          try { await verifyPayment(order.orderId!, response); }
          catch (cause) { setCheckoutError(cause instanceof Error ? cause.message : "Payment verification is pending."); }
        },
        modal: { ondismiss: () => setCheckoutMessage("The payment window closed. Any unpaid stock reservation will expire automatically.") },
      });
      checkout.on("payment.failed", (event) => {
        setCheckoutError(event.error?.description || "The test payment did not complete. You can try again.");
      });
      checkout.open();
    } catch (cause) {
      setCheckoutError(cause instanceof Error ? cause.message : "Checkout could not be started.");
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function checkPaymentAgain() {
    if (!pendingPayment) return;
    setCheckoutBusy(true);
    setCheckoutError(null);
    try { await verifyPayment(pendingPayment.orderId, pendingPayment.response); }
    catch (cause) { setCheckoutError(cause instanceof Error ? cause.message : "Payment verification is pending."); }
    finally { setCheckoutBusy(false); }
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  return (
    <main className="site-shell">
      <div className="announcement">
        <span>MADE IN BIHAR</span><b>✳</b><span>BIG CRUNCH ENERGY</span><b>✳</b><span>SNACK HAPPY</span>
      </div>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="POKHAR'S home">
          <span className="brand-mark">P</span>
          <span className="brand-word">POKHAR’S</span>
          <span className="brand-sub">MAKHANA WITH A MOOD</span>
        </a>

        <button
          className="menu-toggle"
          type="button"
          aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>

        <nav className={mobileMenuOpen ? "main-nav is-open" : "main-nav"}>
          <a href="#flavours" onClick={closeMobileMenu}>FLAVOURS</a>
          <a href="#story" onClick={closeMobileMenu}>OUR STORY</a>
          <a href="#heritage" onClick={closeMobileMenu}>MITHILA VIBES</a>
        </nav>

        <AccountMenu />
        <button className="cart-trigger" type="button" onClick={() => setCartOpen(true)}>
          <span>YOUR BAG</span><span className="cart-count">{cartCount}</span>
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-pink-shape" />
        <div className="hero-copy">
          <p className="hero-kicker"><span>✳</span> THE FLAVOUR PARTY STARTS HERE <span>✳</span></p>
          <h1>SNACK MOOD<br /><span>SWINGS</span></h1>
          <p className="hero-description">
            Crunchy little mood-lifters, inspired by Bihar and made for every kind of day.
            Pick your flavour. Follow your mood.
          </p>
          <a className="hero-button" href="#flavours">FIND YOUR FLAVOUR <span>↘</span></a>
          <div className="hero-sticker"><span>ROOTED IN</span><strong>BIHAR</strong><span>✳ SINCE ALWAYS ✳</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-spark spark-one">✳</div>
          <div className="hero-spark spark-two">✺</div>
          <div className="hero-spark spark-three">✿</div>
          <div className="hero-pouch">
            <div className="pouch-crimp" />
            <div className="pouch-logo">POKHAR’S</div>
            <div className="pouch-rule" />
            <div className="pouch-flavour">MAKHANA<br />CRUNCH</div>
            <div className="pouch-orbit">✳</div>
            <div className="pouch-caption">A TASTE OF BIHAR</div>
            <div className="pouch-net">83 g</div>
          </div>
          <div className="hero-roundel"><span>GOOD</span><b>MOOD</b><span>FOOD!</span></div>
          <div className="hero-floating-note">little bites<br />BIG DELIGHT</div>
        </div>
      </section>

      <div className="ticker" aria-label="Brand message">
        <div className="ticker-track">
          {Array.from({ length: 2 }).map((_, index) => (
            <span className="ticker-set" key={index}>
              <span>CRUNCH INTO HAPPY</span><b>✳</b><span>ROOTED IN BIHAR</span><b>✳</b>
              <span>GOOD MOOD FOOD</span><b>✳</b><span>PASS THE MAKHANA</span><b>✳</b>
            </span>
          ))}
        </div>
      </div>

      <section className="flavours-section" id="flavours">
        <div className="section-heading">
          <div>
            <p className="section-kicker">THE POKHAR’S FLAVOUR CLUB</p>
            <h2>What’s your<br /><span>snack mood?</span></h2>
          </div>
          <p className="section-intro">
            From chill vibes to full-on fire, there’s a little crunch for every mood.
            Swipe through the flavour gang.
          </p>
        </div>

        <div className={hasLiveCatalogue ? "catalogue-note is-live" : "catalogue-note"}>
          <span>✳</span> {catalogueMessage}
        </div>
        {catalogueError && (
          <p className="catalogue-disclaimer" role="status">
            Firestore catalogue is temporarily unavailable. Showing preview products instead.
            Details: {catalogueError}
          </p>
        )}

        <div className="shop-toolbar">
          <div className="filter-list" aria-label="Filter products">
            {filters.map((item) => (
              <button
                className={filter === item ? "filter-button active" : "filter-button"}
                key={item}
                type="button"
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <span className="product-count">{visibleProducts.length} FLAVOUR PICKS</span>
        </div>

        <div className="product-grid">
          {visibleProducts.length === 0 ? (
            <div className="catalogue-empty">
              <strong>Fresh flavours are on the way.</strong>
              <span>We’re getting the approved POKHAR’S products ready for the shop. Please check back soon.</span>
            </div>
          ) : visibleProducts.map((product, productIndex) => {
            const day = dayNames[productIndex] ?? "EVERYDAY";
            return (
              <article className="product-card" key={product.id}>
                <div className="card-heading" style={{ "--flavour": product.accent, "--flavour-ink": product.ink } as React.CSSProperties}>
                  <p>{product.mood}</p>
                  <h3>{day}</h3>
                </div>
                <div className="product-visual" style={{ "--flavour": product.accent, "--flavour-ink": product.ink } as React.CSSProperties}>
                  {product.tag && <span className="product-tag">{product.tag}</span>}
                  {product.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img className="product-photo" src={product.imageUrl} alt={`${product.name} roasted makhana pack`} loading="lazy" decoding="async" />
                  ) : (
                    <div className="product-pack">
                      <div className="pack-crimp" />
                      <div className="pack-brand">POKHAR’S</div>
                      <div className="pack-dots"><i /><i /><i /><i /></div>
                      <div className="pack-name">{product.name}</div>
                      <div className="pack-description">ROASTED MAKHANA</div>
                      <div className="pack-art">{product.symbol}</div>
                      <div className="pack-weight">{product.weight}</div>
                    </div>
                  )}
                </div>
                <div className="product-info">
                  <p>{product.tagline}</p>
                  <div className="product-buy-row">
                    <div><strong>{formatPrice(product.price)}</strong>{product.mrp && product.mrp > product.price ? <del className="product-mrp">{formatPrice(product.mrp)}</del> : null}<span> / {product.weight}</span></div>
                    <button
                      className="add-button"
                      type="button"
                      disabled={cartIsBusy}
                      aria-label={`Add ${product.name} to bag`}
                      onClick={() => addToCart(product.id)}
                    >
                      ADD <b>+</b>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <p className="catalogue-disclaimer">
          Product cards are shown only after the approved pack photo and verified food-label information have been added in the store admin.
        </p>

        <div className="all-flavours-card">
          <div className="all-flavours-copy">
            <p className="section-kicker">CAN’T PICK JUST ONE?</p>
            <h3>POKHAR’S<br /><span>SUNDAY CLUB</span></h3>
            <p>Commitment issues? Take the whole flavour gang home.</p>
          </div>
          <div className="mini-pack-row" aria-label="Featured flavour packs">
            {catalogueProducts.map((product) => (
              <div className="mini-pack" key={product.id} style={{ "--flavour": product.accent, "--flavour-ink": product.ink } as React.CSSProperties}>
                <span>POKHAR’S</span><b>{product.symbol}</b><small>{product.name}</small>
              </div>
            ))}
          </div>
          <a href="#flavours" className="all-flavours-link">MEET THE WHOLE GANG ↗</a>
        </div>
      </section>

      <section className="story-section" id="story">
        <div className="story-art" aria-hidden="true">
          <div className="story-pink-disc" />
          <div className="story-cream-disc">
            <span className="story-sun">✺</span>
            <span className="story-fish fish-left">◉</span>
            <span className="story-lotus">✿</span>
            <span className="story-fish fish-right">◉</span>
            <span className="story-leaves">❧ ❧</span>
            <small>MITHILA · BIHAR · INDIA</small>
          </div>
          <span className="story-side-note">A LITTLE ROOTS. A LOT OF HEART.</span>
        </div>
        <div className="story-copy">
          <p className="section-kicker">OUR KIND OF CRUNCH</p>
          <h2>From our<br />side of the map<br /><span>to your snack time.</span></h2>
          <p>
            POKHAR’S takes inspiration from Bihar’s makhana and Mithila’s colourful
            spirit. We’re bringing that familiar feeling into a fresh, fun snacking
            experience — one little crunch at a time.
          </p>
          <a className="story-link" href="#heritage">GET TO KNOW POKHAR’S <span>↗</span></a>
        </div>
      </section>

      <section className="heritage-section" id="heritage">
        <p className="section-kicker">A LITTLE CULTURE IN THE CRUNCH</p>
        <h2>Our roots are <span>colourful.</span></h2>
        <p>
          Inspired by Mithila’s lively folk-art language — bold lines, happy motifs,
          and stories that feel right at home.
        </p>
        <div className="motif-row">
          <div><span>✿</span><small>LOTUS</small></div>
          <div><span>❧</span><small>VINES</small></div>
          <div><span>≋</span><small>RIVER</small></div>
          <div><span>✳</span><small>FOLK ART</small></div>
          <div><span>◉</span><small>BIHAR</small></div>
        </div>
      </section>

      <section className="closing-banner">
        <p className="section-kicker">GOOD MOOD. GREAT CRUNCH.</p>
        <h2>Let’s make snack time<br /><span>a little happier.</span></h2>
        <a className="hero-button" href="#flavours">PICK YOUR POKHAR’S <b>↗</b></a>
        <span className="closing-spark spark-left">✿</span>
        <span className="closing-spark spark-right">✳</span>
      </section>

      <footer className="site-footer" id="footer">
        <div className="footer-main">
          <div>
            <a className="brand footer-brand" href="#top">
              <span className="brand-mark">P</span>
              <span className="brand-word">POKHAR’S</span>
              <span className="brand-sub">MAKHANA WITH A MOOD</span>
            </a>
            <p>Rooted in Bihar. Ready for your snack break.</p>
          </div>
          <div className="footer-links">
            <div><strong>THE GOOD STUFF</strong><a href="#flavours">Flavours</a><a href="#story">Our Story</a><a href="#heritage">Mithila Vibes</a></div>
            <div><strong>SAY HELLO</strong><a href="mailto:hello@pokhars.in">Email us</a><a href="#top">Back to top ↑</a></div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} POKHAR’S. ALL RIGHTS RESERVED.</span>
          <span>MADE WITH ROOTS & HEART IN BIHAR, INDIA</span>
        </div>
      </footer>

      {cartOpen && (
        <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setCartOpen(false);
        }}>
          <aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title">
            <div className="drawer-header">
              <div><p className="section-kicker">YOUR FLAVOUR PICKS</p><h2 id="cart-title">Your bag <em>({cartCount})</em></h2></div>
              <button className="close-drawer" type="button" aria-label="Close bag" onClick={() => setCartOpen(false)}>✕</button>
            </div>

            {cartItems.length === 0 ? (
              <div className="empty-cart">
                <span>✳</span><h3>Your bag is feeling empty.</h3>
                <p>Find your flavour and bring some crunch home.</p>
                <button className="drawer-cta" type="button" onClick={() => setCartOpen(false)}>BACK TO FLAVOURS</button>
              </div>
            ) : (
              <>
                <div className="cart-lines">
                  {cartItems.map((product) => (
                    <div className="cart-line" key={product.id}>
                      <div className="cart-thumb" style={{ "--flavour": product.accent, "--flavour-ink": product.ink } as React.CSSProperties}>P.</div>
                      <div className="cart-line-detail">
                        <strong>{product.name}</strong>
                        <span>{product.weight} · {formatPrice(product.price)}</span>
                        <div className="quantity-control">
                          <button type="button" disabled={cartIsBusy} aria-label={`Remove one ${product.name}`} onClick={() => changeQuantity(product.id, -1)}>−</button>
                          <span>{cart[product.id]}</span>
                          <button type="button" disabled={cartIsBusy || (cart[product.id] ?? 0) >= 20} aria-label={`Add one ${product.name}`} onClick={() => changeQuantity(product.id, 1)}>+</button>
                        </div>
                      </div>
                      <strong className="line-total">{formatPrice(product.price * cart[product.id])}</strong>
                    </div>
                  ))}
                </div>
                <div className="drawer-summary">
                  <p className="cart-sync-note">
                    {cartSyncError
                      ? `Cart sync issue: ${cartSyncError}`
                      : user
                        ? (cloudCartReady ? "✓ Cart synced to your account" : "Syncing your cart…")
                        : "Cart saved on this device"}
                  </p>
                  <div><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
                  {checkoutConfig?.enabled && checkoutConfig.shippingPaise > 0 && <div><span>Test shipping</span><strong>{formatPricePaise(checkoutConfig.shippingPaise)}</strong></div>}
                  {checkoutConfig?.enabled && <div><span>Test total</span><strong>{formatPricePaise(subtotal * 100 + checkoutConfig.shippingPaise)}</strong></div>}
                  <p>Taxes are not included while shipping and tax settings are being decided.</p>
                  {!user ? (
                    <div className="checkout-notice">Sign in to choose a saved delivery address. Checkout is in test mode only; no real payment will be taken.</div>
                  ) : savedAddresses.length === 0 ? (
                    <div className="checkout-notice">Add a delivery address to your account before checking out. This checkout is test only; live payments are disabled.</div>
                  ) : (
                    <label className="checkout-address-label" htmlFor="checkout-address">DELIVER TO
                      <select id="checkout-address" value={selectedAddressId} onChange={(event) => setSelectedAddressId(event.target.value)}>
                        {savedAddresses.map((address) => <option key={address.id} value={address.id}>{address.recipientName} · {address.city} · {address.pincode}{address.isDefault ? " · Default" : ""}</option>)}
                      </select>
                    </label>
                  )}
                  {checkoutError && <p className="checkout-feedback error" role="alert">{checkoutError}</p>}
                  {checkoutMessage && <p className="checkout-feedback" role="status">{checkoutMessage}</p>}
                  {pendingPayment && <button className="drawer-cta checkout-button secondary" type="button" disabled={checkoutBusy} onClick={() => void checkPaymentAgain()}>{checkoutBusy ? "CHECKING…" : "CHECK PAYMENT STATUS"}</button>}
                  {user && savedAddresses.length > 0 && !checkoutConfig?.enabled && <div className="checkout-notice">Test checkout is not configured yet. Live payments are disabled.</div>}
                  {user && savedAddresses.length === 0 && <a className="checkout-address-link" href="/account/addresses">ADD A DELIVERY ADDRESS →</a>}
                  <button
                    className="drawer-cta checkout-button"
                    type="button"
                    disabled={checkoutBusy || cartIsBusy || (Boolean(user) && (!checkoutConfig?.enabled || !selectedAddressId || savedAddresses.length === 0 || !hasLiveCatalogue))}
                    onClick={() => void startCheckout()}
                  >
                    {checkoutBusy ? "PREPARING TEST CHECKOUT…" : !user ? "SIGN IN TO CHECK OUT" : checkoutConfig?.enabled ? "CONTINUE TO TEST PAYMENT" : "TEST CHECKOUT NOT CONFIGURED"}
                  </button>
                  <p className="checkout-live-note">TEST MODE ONLY · NO REAL PAYMENT · LIVE PAYMENTS DISABLED</p>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
