import bridges from "../assets/banner-bridges.webp";
import { brand } from "../content/site.ts";

export function Retailers() {
  const s = brand.socials;
  return (
    <section className="retail" id="wholesale">
      <div className="bridges">
        <img
          src={bridges}
          alt="Board games build bridges: the St. Louis skyline and Arch over a stone bridge"
          width="1400"
          height="517"
          loading="lazy"
        />
      </div>
      <div className="wrap pad">
        <div>
          <h2>Come play with us.</h2>
          <p>
            Find us demoing at St. Louis farmers markets, Protospiel and game stores around town. Follow along
            for event dates and playtest calls.
          </p>
          <div className="row">
            <a className="btn" href={s.tiktok} target="_blank" rel="noopener">
              TikTok
            </a>
            <a className="btn" href={s.instagram} target="_blank" rel="noopener">
              Instagram
            </a>
            <a className="btn" href={s.facebook} target="_blank" rel="noopener">
              Facebook
            </a>
          </div>
        </div>
        <div className="panel">
          <h3>Sell our games in your store</h3>
          <p>Email us and we’ll reply within 1–3 business days with a wholesale order form.</p>
          <p className="sheets">
            {brand.sellSheets.map((sheet, i) => (
              <span key={sheet.label}>
                {i > 0 && " · "}
                <a href={sheet.url} target="_blank" rel="noopener">
                  {sheet.label}
                </a>
              </span>
            ))}
          </p>
          <a className="btn go" href={`mailto:${brand.retailEmail}?subject=Wholesale%20inquiry`}>
            Email about wholesale
          </a>
        </div>
      </div>
    </section>
  );
}
