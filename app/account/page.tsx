"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AccountMenu } from "@/components/auth/account-menu";
import { useAuth } from "@/components/auth/auth-provider";
import { getFirebaseAuth } from "@/lib/firebase/client";

const isDemoCatalogueMode = process.env.NEXT_PUBLIC_CATALOGUE_DEMO_MODE === "true";

type AccountOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMode: "test" | "live";
  subtotalPaise: number;
  shippingPaise: number;
  totalPaise: number;
  createdAt: string | null;
  items: Array<{ productId: string; name: string; quantity: number; unitPricePaise: number; lineTotalPaise: number }>;
};

function money(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format((paise || 0) / 100);
}

function dateLabel(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "Date unavailable";
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    pending_payment: "Payment pending",
    confirmed: "Confirmed",
    processing: "Processing",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
    refunded: "Refunded",
    expired: "Expired",
    failed: "Payment failed",
  };
  return labels[value] ?? value.replace(/_/g, " ");
}

export default function AccountPage() {
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (authLoading) return () => { active = false; };
    if (!user) {
      setOrders([]);
      setOrdersLoading(false);
      return () => { active = false; };
    }

    setOrdersLoading(true);
    setError(null);
    void (async () => {
      try {
        const token = await getFirebaseAuth()?.currentUser?.getIdToken();
        if (!token) throw new Error("Your sign-in has expired. Please sign in again.");
        const response = await fetch("/api/account/orders", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({})) as { orders?: AccountOrder[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Your orders could not be loaded.");
        if (active) setOrders(Array.isArray(payload.orders) ? payload.orders : []);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Your orders could not be loaded.");
      } finally {
        if (active) setOrdersLoading(false);
      }
    })();

    return () => { active = false; };
  }, [user, authLoading]);

  return (
    <main className="site-shell customer-account-page">
      <div className="announcement"><span>MADE IN BIHAR</span><b>✳</b><span>YOUR POKHAR’S ACCOUNT</span><b>✳</b><span>SNACK HAPPY</span></div>
      <header className="site-header customer-account-header">
        <Link className="brand" href="/" aria-label="POKHAR’S home">
          <span className="brand-mark">P</span><span className="brand-word">POKHAR’S</span><span className="brand-sub">MAKHANA WITH A MOOD</span>
        </Link>
        <nav className="customer-account-nav">
          <Link href="/account/addresses">DELIVERY ADDRESSES</Link>
          <Link href="/">BACK TO SHOP ↗</Link>
        </nav>
        <AccountMenu />
      </header>

      <section className="customer-account-content">
        <div className="customer-account-heading">
          <div><p className="section-kicker">YOUR ACCOUNT</p><h1>Good to see <span>you.</span></h1>
            <p>Keep your delivery details close and see your POKHAR’S orders in one place.</p>
          </div>
        </div>

        {authLoading ? (
          <div className="customer-account-empty">Checking your account…</div>
        ) : !user ? (
          <div className="customer-account-empty">
            <span className="customer-account-icon">P</span>
            <h2>Sign in to view your account.</h2>
            <p>Open the Sign In control above and continue securely with Google. Your orders and saved addresses are private to your account.</p>
          </div>
        ) : (
          <>
            <section className="customer-profile-card">
              <div className="customer-profile-avatar">
                {user.photoURL ? <img src={user.photoURL} alt="" /> : <span>{(user.displayName || user.email || "P").slice(0, 1).toUpperCase()}</span>}
              </div>
              <div className="customer-profile-copy">
                <p className="customer-profile-kicker">SIGNED IN AS</p>
                <h2>{user.displayName || "POKHAR’S customer"}</h2>
                <p>{user.email || "Google account connected"}</p>
              </div>
              <Link className="customer-profile-link" href="/account/addresses">MANAGE ADDRESSES ↗</Link>
            </section>

            {isDemoCatalogueMode && (
              <div className="demo-store-banner customer-account-demo" role="note">
                <strong>DEVELOPMENT STORE · CHECKOUT DISABLED</strong>
                <span>Sample products are for website testing only. No customer orders or payments can be placed while demo mode is active.</span>
              </div>
            )}

            <div className="customer-orders-heading">
              <div><p className="section-kicker">YOUR SNACK JOURNEY</p><h2>Order history</h2></div>
              <span>{orders.length} ORDER{orders.length === 1 ? "" : "S"}</span>
            </div>

            {error && <p className="customer-account-error" role="alert">{error}</p>}
            {ordersLoading ? (
              <div className="customer-account-empty">Loading your orders…</div>
            ) : orders.length === 0 ? (
              <div className="customer-account-empty">
                <span className="customer-account-icon">✳</span>
                <h2>No orders yet.</h2>
                <p>{isDemoCatalogueMode ? "Your sample bag is ready to explore. Real ordering will be enabled after the POKHAR’S product details and store launch are finalised." : "Once you place your first order, its status and details will appear here."}</p>
                <Link className="address-primary-button" href="/">EXPLORE FLAVOURS ↗</Link>
              </div>
            ) : (
              <div className="customer-orders-list">
                {orders.map((order) => (
                  <article className="customer-order-card" key={order.id}>
                    <div className="customer-order-top">
                      <div><p className="customer-order-kicker">ORDER NUMBER</p><h3>{order.orderNumber}</h3><span>{dateLabel(order.createdAt)}</span></div>
                      <div className="customer-order-status"><span className={"customer-order-status-dot status-" + order.status} />{statusLabel(order.status)}</div>
                    </div>
                    <div className="customer-order-items">
                      {order.items.map((item, index) => (
                        <div className="customer-order-item" key={item.productId + "-" + index}>
                          <span>{item.name} × {item.quantity}</span><strong>{money(item.lineTotalPaise)}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="customer-order-bottom">
                      <span>{order.paymentMode === "test" ? "TEST PAYMENT" : order.paymentStatus.toUpperCase()}</span>
                      <strong>{money(order.totalPaise)}</strong>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <footer className="site-footer address-footer"><div className="footer-bottom"><span>© {new Date().getFullYear()} POKHAR’S. ALL RIGHTS RESERVED.</span><Link href="/">BACK TO SHOP ↑</Link></div></footer>
    </main>
  );
}
