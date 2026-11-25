// The Bearded Bundle: what's in it, game by game, and a pre-order button. The price, picture and
// button come from the "Bearded Bundle" item in Square (packages/store-core listing.ts), so checkout
// is the shop's usual Square checkout, with Beard Bucks and royalties like any other order.
import type { CSSProperties } from "react";
import { Link } from "react-router";
import {
  BUCKS_PER_REWARD,
  BUNDLE,
  BUNDLE_OPENS_LABEL,
  canBuy,
  formatCents,
  MIN_REWARD_ORDER_CENTS,
  notOpenYet,
  REWARD_CENTS,
  type Product,
} from "@bearded/store-core";
import { useProducts } from "../api/data.tsx";
import { useCart } from "../cart/CartProvider.tsx";
import { statusText } from "../content/site.ts";
import { useSite } from "../content/SiteProvider.tsx";

/** The bundle to sell: the pre-order first, else the bundle itself. */
export function bundleProduct(products: Product[]): Product | undefined {
  const mine = products.filter((p) => p.game === BUNDLE);
  return mine.find((p) => p.kind === "preorder") ?? mine[0];
}

export function BundlePage() {
  const { bundle, games } = useSite();
  const products = useProducts();
  const cart = useCart();
  const inside = bundle.games.flatMap((slug) => games.filter((g) => g.slug === slug));
  const product = products.state === "ready" ? bundleProduct(products.value) : undefined;
  const art = bundle.art || product?.imageUrl || "";
  const buyable = product ? canBuy(product) : false;
  const waiting = product ? notOpenYet(product) : false;
  const preorder = product?.kind === "preorder";
  const inCart = product ? (cart.lines.find((l) => l.productId === product.id)?.qty ?? 0) : 0;

  return (
    <article className="bundle-page">
      <header className="game-head bundle-head" style={{ "--c": "#f6b820" } as CSSProperties}>
        <div className="wrap">
          <div className="art">
            {art ? (
              <img src={art} alt={`${bundle.name}: ${inside.map((g) => g.name).join(", ")}`} />
            ) : (
              <div className="bundle-covers">
                {inside.map((g) => (
                  <img key={g.slug} src={g.art} alt={`${g.name} box art`} />
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="crumbs">
              <Link to="/shop">Shop</Link>
            </p>
            <div className="tags">
              <span className="tag hot">{preorder ? "Pre-order" : "Bundle"}</span>
              <span className="tag">{inside.length} games</span>
            </div>
            <h1>{bundle.name}</h1>
            <p className="lede">{bundle.tagline}</p>
            {products.state === "loading" && <p>Loading the price…</p>}
            {products.state === "failed" && (
              <p>We couldn’t load the price just now. Refresh the page to try again.</p>
            )}
            {products.state === "ready" &&
              (product ? (
                <div className="bundle-buy">
                  <p className="price">
                    {formatCents(product.priceCents)}
                    {product.priceCents > REWARD_CENTS && (
                      <span className="buddy-price">
                        {formatCents(product.priceCents - REWARD_CENTS)} for Beard Buddies with{" "}
                        {BUCKS_PER_REWARD} Bucks
                      </span>
                    )}
                    {bundle.when && <span className="when">{bundle.when}</span>}
                  </p>
                  <button
                    type="button"
                    className="btn go"
                    disabled={!buyable}
                    onClick={() => cart.add(product)}
                    aria-label={
                      buyable
                        ? `${preorder ? "Pre-order" : "Add"} ${product.name}${preorder ? "" : " to cart"}`
                        : waiting
                          ? `${product.name}: ${BUNDLE_OPENS_LABEL}`
                          : `${product.name} is sold out`
                    }
                  >
                    {waiting
                      ? BUNDLE_OPENS_LABEL
                      : !buyable
                        ? "Sold out"
                        : preorder
                          ? "Pre-order now"
                          : "Add to cart"}
                  </button>
                  {inCart > 0 && (
                    <p className="in-cart">
                      {inCart} in your cart. <Link to="/cart">Check out</Link>
                    </p>
                  )}
                </div>
              ) : (
                <p>
                  Pre-orders aren’t open yet. <Link to="/#buddy">Join Beard Buddy</Link> to hear first.
                </p>
              ))}
          </div>
        </div>
      </header>

      <section className="wrap pad about-game">
        <h2>What’s in the bundle</h2>
        <p>{bundle.blurb}</p>
        <div className="bundle-games">
          {inside.map((g) => (
            <section
              key={g.slug}
              className="bundle-game"
              style={{ "--c": g.color } as CSSProperties}
              aria-labelledby={`bundle-${g.slug}`}
            >
              <Link className="art" to={`/games/${g.slug}`} tabIndex={-1} aria-hidden="true">
                <img src={g.art} alt="" loading="lazy" />
              </Link>
              <div className="body">
                <div className="tags">
                  {g.labels.map((l) => (
                    <span key={l} className={`tag ${l === "Prism Cortex" ? "pc" : ""}`}>
                      {l}
                    </span>
                  ))}
                  {g.status !== "available" && <span className="tag soon">{statusText(g)}</span>}
                </div>
                <h3 id={`bundle-${g.slug}`}>{g.name}</h3>
                <p className="tagline">{g.tagline}</p>
                <ul className="facts">
                  {g.facts.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
                <p>{g.blurb}</p>
                {(g.designer || g.artist) && (
                  <p className="by">
                    {[g.designer && `Designed by ${g.designer}`, g.artist && `art by ${g.artist}`]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
                <p>
                  <Link to={`/games/${g.slug}`}>More about {g.name}</Link>
                </p>
              </div>
            </section>
          ))}
        </div>
        {bundle.note && <p className="bundle-note">{bundle.note}</p>}
      </section>

      {bundle.howItWorks.length > 0 && (
        <section className="wrap pad bundle-how">
          <h2>How pre-orders work</h2>
          <ul>
            {bundle.howItWorks.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <p className="hint">
            Beard Bucks: 1 Buck for every dollar, and every {BUCKS_PER_REWARD} Bucks takes{" "}
            {formatCents(REWARD_CENTS)} off an order of {formatCents(MIN_REWARD_ORDER_CENTS)} or more.{" "}
            <Link to="/account">See your Bucks</Link>
          </p>
        </section>
      )}
    </article>
  );
}
