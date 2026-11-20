"use client";

import { useEffect, useMemo, useState } from "react";
import { products } from "@/lib/products";

type Filter = "All" | "Classic" | "Masala" | "Premium";
type Cart = Record<string, number>;

const filters: Filter[] = ["All", "Classic", "Masala", "Premium"];

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function HomePage() {
  const [filter, setFilter] = useState<Filter>("All");
  const [cart, setCart] = useState<Cart>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [cartReady, setCartReady] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  useEffect(() => {
    if (cartReady) {
      window.localStorage.setItem("pokhars-cart-v1", JSON.stringify(cart));
    }
  }, [cart, cartReady]);

  const visibleProducts = useMemo(
    () =>
      filter === "All"
        ? products
        : products.filter((product) => product.category === filter),
    [filter],
  );

  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const cartItems = products.filter((product) => (cart[product.id] ?? 0) > 0);
  const subtotal = cartItems.reduce(
    (sum, product) => sum + product.price * (cart[product.id] ?? 0),
    0,
  );

  function addToCart(id: string) {
    setCart((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
    setCartOpen(true);
  }

  function changeQuantity(id: string, amount: number) {
    setCart((current) => {
      const next = { ...current };
      const quantity = (next[id] ?? 0) + amount;
      if (quantity <= 0) delete next[id];
      else next[id] = quantity;
      return next;
    });
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  return (
    <main>
      <div className="announcement">
        <span>ROOTED IN BIHAR</span>
        <span className="announcement-dot">✳</span>
        <span>MADE FOR YOUR EVERYDAY CRUNCH</span>
      </div>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="POKHAR'S home">
          <span className="brand-mark">P</span>
          <span className="brand-word">POKHAR’S</span>
          <span className="brand-sub">A TASTE OF BIHAR</span>
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
          <a href="#shop" onClick={closeMobileMenu}>SHOP</a>
          <a href="#story" onClick={closeMobileMenu}>OUR STORY</a>
          <a href="#heritage" onClick={closeMobileMenu}>MITHILA HERITAGE</a>
          <a href="#footer" onClick={closeMobileMenu}>CONTACT</a>
        </nav>

        <button className="cart-trigger" type="button" onClick={() => setCartOpen(true)}>
          <span>YOUR BAG</span>
          <span className="cart-count">{cartCount}</span>
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-line" /> THE BIHAR-ROOTED SNACK</p>
          <h1>A little crunch.<br /><em>A lot of</em> heritage.</h1>
          <p className="hero-description">
            Meet a much-loved bite from Bihar, made for a new generation of snack
            lovers. Thoughtful flavours. A story worth sharing.
          </p>
          <div className="hero-actions">
            <a className="button button-dark" href="#shop">EXPLORE THE RANGE <span>↗</span></a>
            <a className="text-link" href="#story">THE POKHAR’S STORY <span>→</span></a>
          </div>
          <div className="hero-footnote"><span>✳</span> CELEBRATING THE CULTURE OF MITHILA</div>
        </div>

        <div className="hero-art" aria-label="Decorative makhana-inspired illustration">
          <div className="hero-sun" />
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-art-label label-top">FROM BIHAR, WITH LOVE</div>
          <div className="hero-bowl">
            <div className="bowl-rim" />
            <div className="bowl-body">
              <span className="bowl-pattern">✳　❋　✳</span>
              <span className="bowl-brand">POKHAR’S</span>
              <span className="bowl-caption">MAKHANA</span>
            </div>
            <div className="makhana makhana-one">✿</div>
            <div className="makhana makhana-two">✿</div>
            <div className="makhana makhana-three">✿</div>
            <div className="makhana makhana-four">✿</div>
            <div className="makhana makhana-five">✿</div>
          </div>
          <div className="hero-stamp"><span>ROOTED</span><strong>IN</strong><span>BIHAR</span></div>
          <div className="hero-art-label label-bottom">A TRADITION, REIMAGINED</div>
          <div className="hero-side-note">PURE JOY · EVERY BITE</div>
        </div>
      </section>

      <div className="ticker" aria-label="Brand values">
        <div className="ticker-track">
          {Array.from({ length: 2 }).map((_, index) => (
            <span className="ticker-set" key={index}>
              <span>FROM THE HEART OF BIHAR</span><b>✳</b>
              <span>MADE TO BE SHARED</span><b>✳</b>
              <span>A LITTLE TASTE OF HOME</span><b>✳</b>
              <span>CRUNCH WITH CULTURE</span><b>✳</b>
            </span>
          ))}
        </div>
      </div>

      <section className="shop-section section-wrap" id="shop">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE POKHAR’S PANTRY</p>
            <h2>Find your <em>favourite</em> crunch.</h2>
          </div>
          <p className="section-intro">
            A preview of the flavours we’re bringing to the table. Pick a mood,
            find your crunch.
          </p>
        </div>

        <div className="catalogue-note">
          <span>✳</span> PREVIEW CATALOGUE — SAMPLE FLAVOURS AND PRICES FOR WEBSITE TESTING
        </div>

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
          <span className="product-count">{visibleProducts.length} PREVIEW PICKS</span>
        </div>

        <div className="product-grid">
          {visibleProducts.map((product, index) => (
            <article className="product-card" key={product.id}>
              <div
                className="product-visual"
                style={{ "--flavour": product.accent } as React.CSSProperties}
              >
                {product.tag && <span className="product-tag">{product.tag}</span>}
                <span className="product-number">0{index + 1}</span>
                <div className="product-halo" />
                <div className="product-pack">
                  <div className="pack-seal">✳</div>
                  <div className="pack-brand">POKHAR’S</div>
                  <div className="pack-rule" />
                  <div className="pack-name">{product.name}</div>
                  <div className="pack-type">ROASTED MAKHANA</div>
                  <div className="pack-weight">{product.weight}</div>
                  <div className="pack-flower">{product.symbol}</div>
                </div>
                <span className="product-visual-caption">A TASTE OF BIHAR</span>
              </div>
              <div className="product-info">
                <div>
                  <p className="product-flavour">{product.flavour}</p>
                  <h3>{product.name}</h3>
                  <p className="product-note">{product.note}</p>
                </div>
                <div className="product-buy-row">
                  <div><strong>{formatPrice(product.price)}</strong><span> / {product.weight}</span></div>
                  <button
                    className="add-button"
                    type="button"
                    aria-label={`Add ${product.name} to bag`}
                    onClick={() => addToCart(product.id)}
                  >
                    <span>ADD</span><b>+</b>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        <p className="catalogue-disclaimer">
          These are demonstration products. Final flavours, pack details, ingredients and
          selling prices will be updated from the approved product catalogue.
        </p>
      </section>

      <section className="story-section" id="story">
        <div className="story-art">
          <div className="story-frame">
            <span className="story-art-top">✳ &nbsp; THE LAND OF STORIES &nbsp; ✳</span>
            <div className="story-sun-motif">☼</div>
            <div className="story-illustration">
              <span className="story-leaf leaf-a">❧</span>
              <span className="story-leaf leaf-b">❧</span>
              <span className="story-fish">◉</span>
              <span className="story-lotus">✿</span>
              <span className="story-fish fish-two">◉</span>
            </div>
            <span className="story-art-bottom">MITHILA · BIHAR · INDIA</span>
          </div>
        </div>
        <div className="story-copy">
          <p className="eyebrow">MORE THAN A SNACK</p>
          <h2>Our roots run<br />deep. <em>Our spirit</em><br />runs free.</h2>
          <p>
            POKHAR’S begins with a simple feeling: the things we grow up with
            deserve a place in the world we’re creating. We’re bringing the
            familiar joy of makhana into a fresh, modern snacking experience.
          </p>
          <a className="text-link text-link-light" href="#heritage">GET TO KNOW US <span>→</span></a>
        </div>
      </section>

      <section className="heritage-section section-wrap" id="heritage">
        <p className="eyebrow">INSPIRED BY MITHILA</p>
        <h2>Culture in every <em>detail.</em></h2>
        <p className="heritage-copy">
          From expressive lines to lively motifs, Mithila’s visual language is full
          of character. It inspires the world of POKHAR’S — a brand that looks
          forward without leaving its roots behind.
        </p>
        <div className="motif-row" aria-label="Mithila-inspired decorative motifs">
          <div><span>✿</span><small>LOTUS</small></div>
          <div><span>♧</span><small>VINES</small></div>
          <div><span>≋</span><small>RIVER</small></div>
          <div><span>✳</span><small>ORNAMENT</small></div>
          <div><span>◉</span><small>FOLK ART</small></div>
        </div>
      </section>

      <section className="closing-banner">
        <div className="closing-ornament">✳</div>
        <p className="eyebrow">A LITTLE JOY GOES A LONG WAY</p>
        <h2>Bring home a taste<br />of <em>Bihar.</em></h2>
        <a className="button button-light" href="#shop">DISCOVER POKHAR’S <span>↗</span></a>
      </section>

      <footer className="site-footer" id="footer">
        <div className="footer-main">
          <div className="footer-brand">
            <a className="brand brand-footer" href="#top">
              <span className="brand-mark">P</span>
              <span className="brand-word">POKHAR’S</span>
              <span className="brand-sub">A TASTE OF BIHAR</span>
            </a>
            <p>Rooted in Bihar. Made for everywhere.</p>
          </div>
          <div className="footer-links">
            <div><strong>EXPLORE</strong><a href="#shop">Shop</a><a href="#story">Our Story</a><a href="#heritage">Mithila Heritage</a></div>
            <div><strong>CONNECT</strong><a href="mailto:hello@pokhars.in">Email us</a><a href="#top">Back to top ↑</a></div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} POKHAR’S. ALL RIGHTS RESERVED.</span>
          <span>CRAFTED WITH ROOTS & HEART IN BIHAR, INDIA</span>
        </div>
      </footer>

      {cartOpen && (
        <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setCartOpen(false);
        }}>
          <aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title">
            <div className="drawer-header">
              <div><p className="eyebrow">YOUR POKHAR’S PICKS</p><h2 id="cart-title">Your bag <em>({cartCount})</em></h2></div>
              <button className="close-drawer" type="button" aria-label="Close bag" onClick={() => setCartOpen(false)}>✕</button>
            </div>

            {cartItems.length === 0 ? (
              <div className="empty-cart">
                <span>✳</span><h3>Your bag is waiting.</h3>
                <p>Find a favourite crunch and add it here.</p>
                <button className="button button-dark" type="button" onClick={() => setCartOpen(false)}>EXPLORE THE RANGE</button>
              </div>
            ) : (
              <>
                <div className="cart-lines">
                  {cartItems.map((product) => (
                    <div className="cart-line" key={product.id}>
                      <div className="cart-thumb" style={{ "--flavour": product.accent } as React.CSSProperties}>P.</div>
                      <div className="cart-line-detail">
                        <strong>{product.name}</strong>
                        <span>{product.weight} · {formatPrice(product.price)}</span>
                        <div className="quantity-control">
                          <button type="button" aria-label={`Remove one ${product.name}`} onClick={() => changeQuantity(product.id, -1)}>−</button>
                          <span>{cart[product.id]}</span>
                          <button type="button" aria-label={`Add one ${product.name}`} onClick={() => changeQuantity(product.id, 1)}>+</button>
                        </div>
                      </div>
                      <strong className="line-total">{formatPrice(product.price * cart[product.id])}</strong>
                    </div>
                  ))}
                </div>
                <div className="drawer-summary">
                  <div><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
                  <p>Shipping and taxes will be calculated at checkout.</p>
                  <div className="checkout-notice">
                    Checkout is not connected yet. This preview lets you test the shopping bag; payment and order placement will be added in the next build.
                  </div>
                  <button className="button button-dark checkout-button" type="button" onClick={() => setCartOpen(false)}>CONTINUE SHOPPING</button>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
