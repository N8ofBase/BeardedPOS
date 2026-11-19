import { Link } from "react-router";
import { soccerBlockerRules } from "../content/site.ts";

/** The Soccer Blocker rules sheet at its old address, /soccerblocker, for QR codes printed on boxes. */
export function SoccerBlockerRulesPage() {
  return (
    <section className="wrap pad rules-page">
      <p className="crumbs">
        <Link to="/games/soccer-blocker">Soccer Blocker</Link>
      </p>
      <h1>Soccer Blocker rules</h1>
      <p className="lede">Both sides of the rules sheet. Tap a side to open it full size.</p>
      <div className="sheets">
        {soccerBlockerRules.map((p) => (
          <figure key={p.src}>
            <a href={p.full} target="_blank" rel="noopener">
              <img src={p.src} alt={p.alt} />
            </a>
            <figcaption>{p.caption}</figcaption>
          </figure>
        ))}
      </div>
      <p>
        <Link className="btn go" to="/games/soccer-blocker">
          More about Soccer Blocker
        </Link>
      </p>
    </section>
  );
}
