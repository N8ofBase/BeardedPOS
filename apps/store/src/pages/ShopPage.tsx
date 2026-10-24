import { useProducts } from "../api/data.tsx";
import { ProductCard } from "../components/ProductCard.tsx";
import { games } from "../content/site.ts";
import type { Product } from "@bearded/store-core";

export function ShopPage() {
  const products = useProducts();
  return (
    <section className="shop page">
      <div className="wrap pad">
        <h1>Shop</h1>
        <p className="lede">
          Games, expansions, print and play, and a little merch. Pick up free in St. Louis or ship it.
        </p>
        {products.state === "loading" && <p>Loading the shelf…</p>}
        {products.state === "failed" && (
          <p>We couldn’t load the shop just now. Refresh the page to try again.</p>
        )}
        {products.state === "ready" && <ShopGroups products={products.value} />}
      </div>
    </section>
  );
}

function ShopGroups({ products }: { products: Product[] }) {
  const groups = [
    ...games.map((g) => ({ key: g.slug, title: g.name, items: products.filter((p) => p.game === g.slug) })),
    { key: "more", title: "More from the beards", items: products.filter((p) => p.game === null) },
  ].filter((g) => g.items.length > 0);
  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className="group" aria-labelledby={`group-${g.key}`}>
          <h2 id={`group-${g.key}`}>{g.title}</h2>
          <div className="grid">
            {g.items.map((p) => (
              <ProductCard key={p.id} product={p} showGame={false} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
