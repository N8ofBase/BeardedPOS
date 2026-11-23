import type { CSSProperties } from "react";
import { Link } from "react-router";
import { formatCents, stockLabel, type Product } from "@bearded/store-core";
import { BUNDLE, canBuy } from "@bearded/store-core";
import { useCart } from "../cart/CartProvider.tsx";
import { useSite } from "../content/SiteProvider.tsx";
import { gamePath } from "../roll.ts";

/** `linkArt`: the picture opens the item's game page (off on that page itself). */
export function ProductCard({
  product,
  showGame = true,
  linkArt = true,
}: {
  product: Product;
  showGame?: boolean;
  linkArt?: boolean;
}) {
  const cart = useCart();
  const { games, bundle } = useSite();
  // The Bearded Bundle links to its own page, like a game.
  const game =
    product.game === BUNDLE
      ? { slug: BUNDLE, name: bundle.name, color: "#f6b820", art: bundle.art || undefined }
      : games.find((g) => g.slug === product.game);
  const path = product.game === BUNDLE ? "/bundle" : game ? gamePath(game.slug) : "";
  const label = stockLabel(product);
  const art = product.imageUrl ?? game?.art;
  const buyable = canBuy(product);
  const inCart = cart.lines.find((l) => l.productId === product.id)?.qty ?? 0;
  return (
    <article
      className={`product ${buyable ? "" : "out"}`}
      style={{ "--c": game?.color ?? "#14614F" } as CSSProperties}
    >
      {linkArt && game ? (
        <Link className="art" to={path} tabIndex={-1} aria-hidden="true">
          {art ? (
            <img src={art} alt="" loading="lazy" />
          ) : (
            <span className="art-fallback">{product.name}</span>
          )}
        </Link>
      ) : (
        <div className="art">
          {art ? (
            <img src={art} alt="" loading="lazy" />
          ) : (
            <span className="art-fallback">{product.name}</span>
          )}
        </div>
      )}
      <div className="body">
        {showGame && game && (
          <Link className="tag" to={path}>
            {game.name}
          </Link>
        )}
        <h3>{product.name}</h3>
        <p className="price">
          {formatCents(product.priceCents)}
          {label && <span className={`stock ${product.stockStatus}`}>{label}</span>}
        </p>
        <button
          type="button"
          className="btn go add"
          disabled={!buyable}
          onClick={() => cart.add(product)}
          aria-label={buyable ? `Add ${product.name} to cart` : `${product.name} is sold out`}
        >
          {!buyable ? "Sold out" : product.kind === "preorder" ? "Pre-order" : "Add to cart"}
        </button>
        {inCart > 0 && <p className="in-cart">{inCart} in your cart</p>}
      </div>
    </article>
  );
}
