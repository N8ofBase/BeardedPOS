import { Link } from "react-router";
import meeple from "../assets/meeple.webp";
import { useSignedIn } from "../buddy/BuddyProvider.tsx";
import { useCart } from "../cart/CartProvider.tsx";
import { brand } from "../content/site.ts";

export function Header() {
  const cart = useCart();
  const count = cart.summary?.count ?? cart.lines.reduce((n, l) => n + l.qty, 0);
  const account = useSignedIn();
  return (
    <header className="site-head">
      <div className="wrap">
        <Link className="brand" to="/">
          <img src={meeple} alt="" width="40" height="39" />
          <span>{brand.name}</span>
        </Link>
        <nav aria-label="Main">
          <Link to="/#games">Games</Link>
          <Link to="/shop">Shop</Link>
          <Link to="/reviews">Reviews</Link>
          <Link to="/videos">Videos</Link>
          <Link to="/#vip">VIP list</Link>
          <Link to="/wholesale">Wholesale</Link>
          <Link to="/account" className="buddy-link">
            Beard Buddy
            {account && <span className="bucks"> · {account.balance.toLocaleString("en-US")} Bucks</span>}
          </Link>
          <button type="button" className="cart-btn" onClick={cart.open}>
            Cart
            <span className="count" aria-label={`${count} item${count === 1 ? "" : "s"}`}>
              {count}
            </span>
          </button>
        </nav>
      </div>
    </header>
  );
}
