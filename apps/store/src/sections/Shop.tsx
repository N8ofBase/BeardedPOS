import type { CSSProperties } from "react";
import { formatCents, stockLabel, type Product } from "../catalog/catalog.ts";
import { useProducts } from "../api/store.ts";
import { games } from "../content/site.ts";

const gameFor = (p: Product) => games.find((g) => g.slug === p.game);

function ProductCard({ product }: { product: Product }) {
  const game = gameFor(product);
  const label = stockLabel(product);
  const art = product.imageUrl ?? game?.art;
  return (
    <article className={`product ${product.stockStatus === "sold-out" ? "out" : ""}`}>
      <div className="art" style={{ "--c": game?.color ?? "#14614F" } as CSSProperties}>
        {art ? <img src={art} alt="" loading="lazy" /> : <span className="art-fallback">{product.name}</span>}
      </div>
      <div className="body">
        {game && <span className="tag">{game.name}</span>}
        <h3>{product.name}</h3>
        <p className="price">
          {formatCents(product.priceCents)}
          {label && <span className={`stock ${product.stockStatus}`}>{label}</span>}
        </p>
      </div>
    </article>
  );
}

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
            {products.value.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
