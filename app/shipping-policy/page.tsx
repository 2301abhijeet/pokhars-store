import Link from "next/link";
import { ShippingChecker } from "@/components/store/shipping-checker";

export default function ShippingPolicyPage() {
  return (
    <main className="site-shell shipping-policy-page">
      <div className="announcement"><span>MADE IN BIHAR</span><b>✳</b><span>DELIVERY INFORMATION</span><b>✳</b><span>SNACK HAPPY</span></div>
      <header className="site-header shipping-policy-header">
        <Link className="brand" href="/" aria-label="POKHAR’S home">
          <span className="brand-mark">P</span><span className="brand-word">POKHAR’S</span><span className="brand-sub">MAKHANA WITH A MOOD</span>
        </Link>
        <Link className="shipping-policy-back" href="/">BACK TO SHOP ↗</Link>
      </header>

      <section className="shipping-policy-content">
        <p className="section-kicker">DELIVERY & SHIPPING</p>
        <h1>Good snacks, <span>on their way.</span></h1>
        <p className="shipping-policy-intro">Check whether delivery is configured for your area and see the current shipping estimate before you plan your order.</p>

        <ShippingChecker />

        <div className="shipping-policy-grid">
          <article className="shipping-policy-card">
            <span>01 · CHECK YOUR AREA</span>
            <h2>PIN-code serviceability</h2>
            <p>Enter your 6-digit PIN code above. The checker uses the delivery zones currently configured by POKHAR’S. If a PIN code is not listed, delivery is not currently enabled for that area.</p>
          </article>
          <article className="shipping-policy-card">
            <span>02 · SHIPPING CHARGES</span>
            <h2>Clear delivery fees</h2>
            <p>Shipping charges depend on the configured delivery zone and cart value. Any free-shipping threshold, where enabled, is applied automatically to the estimate.</p>
          </article>
          <article className="shipping-policy-card">
            <span>03 · DELIVERY ESTIMATE</span>
            <h2>When it may arrive</h2>
            <p>The estimate combines the store’s configured handling time with the delivery range for your zone. It is an estimate, not a guaranteed delivery date.</p>
          </article>
          <article className="shipping-policy-card">
            <span>04 · TRACK YOUR ORDER</span>
            <h2>Follow the journey</h2>
            <p>Once an order is shipped and tracking details are added, signed-in customers can see the courier name, tracking number and shipment link in their account.</p>
          </article>
        </div>

        <div className="shipping-policy-note">
          <strong>PLEASE NOTE</strong>
          <p>PIN-code coverage is maintained manually from the delivery areas confirmed by our courier partner. This checker is not a live courier-network lookup. Delivery availability, fees and estimates are confirmed again during checkout when ordering is enabled.</p>
        </div>
        <Link className="shipping-policy-cta" href="/">EXPLORE POKHAR’S FLAVOURS ↗</Link>
      </section>
      <footer className="site-footer address-footer"><div className="footer-bottom"><span>© {new Date().getFullYear()} POKHAR’S. ALL RIGHTS RESERVED.</span><Link href="/">BACK TO SHOP ↑</Link></div></footer>
    </main>
  );
}
