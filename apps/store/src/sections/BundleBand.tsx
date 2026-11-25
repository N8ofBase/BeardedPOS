// The Bearded Bundle on the home page, just before the shelf: the three games, the price from Square
// and a link to the bundle page. Its words come from the "The Bearded Bundle" group in Site content.
import { Link } from "react-router";
import {
  BUCKS_PER_REWARD,
  formatCents,
  notOpenYet,
  REWARD_CENTS,
  BUNDLE_OPENS_LABEL,
} from "@bearded/store-core";
import { useProducts } from "../api/data.tsx";
import { useSite } from "../content/SiteProvider.tsx";
import { bundleProduct } from "../pages/BundlePage.tsx";

export function BundleBand() {
  const { bundle, games } = useSite();
  const products = useProducts();
  const inside = bundle.games.flatMap((slug) => games.filter((g) => g.slug === slug));
  const product = products.state === "ready" ? bundleProduct(products.value) : undefined;
  const art = bundle.art || product?.imageUrl || "";
  return (
    <section className="bundle-band" id="bundle" aria-labelledby="bundle-band-title">
      <div className="wrap pad">
        <Link className="art" to="/bundle" tabIndex={-1} aria-hidden="true">
          {art ? (
            <img src={art} alt="" loading="lazy" />
          ) : (
            <span className="band-covers">
              {inside.map((g) => (
                <img key={g.slug} src={g.art} alt="" loading="lazy" />
              ))}
            </span>
          )}
        </Link>
        <div>
          <p className="kicker">{product?.kind === "preorder" ? "Pre-order" : "New"}</p>
          <h2 id="bundle-band-title">{bundle.name}</h2>
          <p className="lede">{bundle.tagline}</p>
          <p>
            {inside.map((g) => g.name).join(", ")}
            {bundle.when && <> · {bundle.when}</>}
          </p>
          {product && (
            <p className="price">
              {formatCents(product.priceCents)}
              {product.priceCents > REWARD_CENTS && (
                <span className="buddy-price">
                  {formatCents(product.priceCents - REWARD_CENTS)} for Beard Buddies with {BUCKS_PER_REWARD}{" "}
                  Bucks
                </span>
              )}
            </p>
          )}
          <p className="row">
            <Link className="btn go" to="/bundle">
              See what’s inside
            </Link>
            {product && notOpenYet(product) && <span className="opens">{BUNDLE_OPENS_LABEL}</span>}
          </p>
        </div>
      </div>
    </section>
  );
}
