import type { CSSProperties } from "react";
import { Link } from "react-router";
import { formatCents, stockLabel, type Product } from "../catalog/catalog.ts";
import { canBuy } from "../cart/cart.ts";
import { useCart } from "../cart/CartProvider.tsx";
import { games } from "../content/site.ts";
import { gamePath } from "../roll.ts";

export function ProductCard({ product, showGame = true }: { product: Product; showGame?: boolean }) {
  const cart = useCart();
  const game = games.find((g) => g.slug === product.game);
  const label = stockLabel(product);
  const art = product.imageUrl ?? game?.art;
  const buyable = canBuy(product);
  const inCart = cart.lines.find((l) => l.productId === product.id)?.qty ?? 0;
  return (
    <article
      className={`product ${buyable ? "" : "out"}`}
      style={{ "--c": game?.color ?? "#14614F" } as CSSProperties}
    >
      <div className="art">
        {art ? <img src={art} alt="" loading="lazy" /> : <span className="art-fallback">{product.name}</span>}
      </div>
      <div className="body">
        {showGame && game && (
          <Link className="tag" to={gamePath(game.slug)}>
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
