import { Link } from "react-router";
import { useProducts } from "../api/data.tsx";
import { ProductCard } from "../components/ProductCard.tsx";

/** The home page's shop band: the games themselves, with a link to everything. */
export function Shop() {
  const products = useProducts();
  return (
    <section className="shop" id="shop">
      <div className="wrap pad">
        <h2>Shop</h2>
        <p className="lede">
          Prices and stock come straight from our shop at the counter, so what you see is what we have.
        </p>
        {products.state === "loading" && <p>Loading the shelf…</p>}
        {products.state === "failed" && (
          <p>We couldn’t load the shop just now. Refresh the page to try again.</p>
        )}
        {products.state === "ready" && (
          <div className="grid">
            {products.value
              .filter((p) => p.kind === "game" || p.kind === "preorder")
              .map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
          </div>
        )}
        <p className="more">
          <Link className="btn" to="/shop">
            See expansions, print and play, and merch
          </Link>
        </p>
      </div>
    </section>
  );
}
