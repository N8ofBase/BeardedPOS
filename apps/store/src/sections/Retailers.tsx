import { useSite } from "../content/SiteProvider.tsx";

export function Retailers() {
  const { brand, text } = useSite();
  const s = brand.socials;
  return (
    <section className="retail" id="wholesale">
      <div className="bridges">
        <img
          src={text.retailBanner}
          alt="Board games build bridges: the St. Louis skyline and Arch over a stone bridge"
          width="1400"
          height="517"
          loading="lazy"
        />
      </div>
      <div className="wrap pad">
        <div>
          <h2>{text.playHeading}</h2>
          <p>{text.playText}</p>
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
          <h3>{text.sellHeading}</h3>
          <p>{text.sellText}</p>
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
