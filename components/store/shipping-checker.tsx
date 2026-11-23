"use client";

import { useState, type FormEvent } from "react";

type ShippingQuote = {
  configured: boolean;
  serviceable: boolean;
  message: string;
  zoneName?: string;
  shippingFeePaise?: number;
  freeShippingApplied?: boolean;
  deliveryMinDays?: number;
  deliveryMaxDays?: number;
};

function money(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100);
}

export function ShippingChecker({ subtotalPaise = 0 }: { subtotalPaise?: number }) {
  const [pincode, setPincode] = useState("");
  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[1-9][0-9]{5}$/.test(pincode)) {
      setError("Enter a valid 6-digit Indian PIN code.");
      setQuote(null);
      return;
    }
    setBusy(true);
    setError(null);
    setQuote(null);
    try {
      const response = await fetch(
        `/api/store/shipping?pincode=${encodeURIComponent(pincode)}&subtotalPaise=${Math.max(0, Math.round(subtotalPaise))}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => ({})) as ShippingQuote & { error?: string };
      if (!response.ok) throw new Error(data.error || "Delivery availability could not be checked.");
      setQuote(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delivery availability could not be checked.");
    } finally {
      setBusy(false);
    }
  }

  if (process.env.NEXT_PUBLIC_CATALOGUE_DEMO_MODE === "true") {
    return (
      <section className="shipping-checker" aria-label="Demo checkout delivery notice">
        <div className="shipping-checker-heading"><span>DEMO TEST MODE</span><strong>Delivery is not applicable</strong></div>
        <p className="shipping-checker-footnote">These are sample catalogue products. Test orders are not packed or shipped, and demo payments never change inventory.</p>
      </section>
    );
  }

  return (
    <section className="shipping-checker" aria-label="Check delivery availability">
      <div className="shipping-checker-heading"><span>DELIVERY CHECK</span><strong>Check your PIN code</strong></div>
      <form className="shipping-checker-form" onSubmit={check}>
        <label htmlFor="shipping-pincode">6-digit delivery PIN code</label>
        <div className="shipping-checker-controls">
          <input
            id="shipping-pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            pattern="[1-9][0-9]{5}"
            placeholder="e.g. 846001"
            value={pincode}
            onChange={(event) => { setPincode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6)); setQuote(null); setError(null); }}
            required
          />
          <button type="submit" disabled={busy || pincode.length !== 6}>{busy ? "CHECKING…" : "CHECK PIN"}</button>
        </div>
      </form>
      {error && <p className="shipping-checker-result is-error" role="alert">{error}</p>}
      {quote && (
        <div className={`shipping-checker-result ${quote.serviceable ? "is-success" : "is-unavailable"}`} role="status">
          <strong>{quote.message}</strong>
          {quote.serviceable && (
            <div className="shipping-quote-details">
              <span>Delivery zone <b>{quote.zoneName}</b></span>
              <span>Shipping fee <b>{quote.freeShippingApplied ? "FREE" : money(quote.shippingFeePaise ?? 0)}</b></span>
              <span>Estimated delivery <b>{quote.deliveryMinDays}–{quote.deliveryMaxDays} days</b></span>
            </div>
          )}
        </div>
      )}
      <small className="shipping-checker-footnote">Use the PIN from your delivery address. Availability and estimates use the store’s manually configured delivery zones, not a live courier lookup. Product pages estimate one pack; the bag checker uses the full bag subtotal. { "The saved-address PIN and final shipping fee are recalculated by the server at checkout." }</small>
    </section>
  );
}
