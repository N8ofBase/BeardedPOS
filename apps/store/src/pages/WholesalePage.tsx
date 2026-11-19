import { useSite } from "../content/SiteProvider.tsx";
import { Retailers } from "../sections/Retailers.tsx";

export function WholesalePage() {
  const { brand } = useSite();
  return (
    <>
      <Retailers />
      <section className="wrap pad sell-sheets">
        <h2>Sell sheets</h2>
        <p className="lede">Tap a game to download its sell sheet.</p>
        <ul>
          {brand.sellSheets.map(
            (sheet) =>
              sheet.picture && (
                <li key={sheet.label}>
                  <a href={sheet.url} target="_blank" rel="noopener">
                    <img src={sheet.picture} alt={sheet.alt} loading="lazy" />
                    <span>{sheet.label} sell sheet</span>
                  </a>
                </li>
              ),
          )}
        </ul>
      </section>
    </>
  );
}
