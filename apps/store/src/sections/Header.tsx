import meeple from "../assets/meeple.webp";
import { brand } from "../content/site.ts";

export function Header() {
  return (
    <header className="site-head">
      <div className="wrap">
        <a className="brand" href="/">
          <img src={meeple} alt="" width="40" height="39" />
          <span>{brand.name}</span>
        </a>
        <nav aria-label="Main">
          <a href="/#games">Games</a>
          <a href="/#shop">Shop</a>
          <a href="/#vip">VIP list</a>
          <a href="/#wholesale">Wholesale</a>
        </nav>
      </div>
    </header>
  );
}
