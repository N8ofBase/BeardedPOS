import { useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { gamePath } from "../roll.ts";
import { games, statusLabel, type Game, type GameStatus } from "../content/site.ts";

type Filter = "all" | GameStatus;
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "available", label: statusLabel.available },
  { id: "preorder", label: statusLabel.preorder },
  { id: "coming-soon", label: statusLabel["coming-soon"] },
];

export const shelfGames = (filter: Filter) =>
  filter === "all" ? games : games.filter((g) => g.status === filter);

function GameCard({ game }: { game: Game }) {
  const [broken, setBroken] = useState(false);
  const links = [
    game.links.rules && { label: "Rules (PDF)", href: game.links.rules },
    game.links.bgg && { label: "BoardGameGeek", href: game.links.bgg },
  ].filter((l): l is { label: string; href: string } => Boolean(l));
  return (
    <article className="box" id={`game-${game.slug}`} style={{ "--c": game.color } as CSSProperties}>
      <div className="art">
        {broken ? (
          <span className="art-fallback">{game.name}</span>
        ) : (
          <img src={game.art} alt={`${game.name} box art`} loading="lazy" onError={() => setBroken(true)} />
        )}
      </div>
      <div className="body">
        <div className="tags">
          {game.labels.map((l) => (
            <span key={l} className={`tag ${l === "Prism Cortex" ? "pc" : ""}`}>
              {l}
            </span>
          ))}
          {game.status !== "available" && <span className="tag soon">{statusLabel[game.status]}</span>}
          {game.badge && <span className="tag hot">{game.badge}</span>}
        </div>
        <h3>
          <Link to={gamePath(game.slug)}>{game.name}</Link>
        </h3>
        <p>{game.tagline}</p>
        {game.facts.length > 0 && (
          <ul className="facts">
            {game.facts.slice(0, 3).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        <details>
          <summary>How it plays</summary>
          <p>{game.blurb}</p>
          {game.designer && <p className="by">Designed by {game.designer}</p>}
          <p className="links">
            <Link to={gamePath(game.slug)}>See {game.name} and its reviews</Link>
          </p>
          {links.length > 0 && (
            <p className="links">
              {links.map((l, i) => (
                <span key={l.href}>
                  {i > 0 && " · "}
                  <a href={l.href} target="_blank" rel="noopener">
                    {l.label}
                  </a>
                </span>
              ))}
            </p>
          )}
        </details>
      </div>
    </article>
  );
}

export function Shelf() {
  const [filter, setFilter] = useState<Filter>("all");
  return (
    <section className="shelf" id="games">
      <div className="wrap pad">
        <h2>On the shelf</h2>
        <p className="lede">
          Bearded classics, a couple of Prism Cortex collaborations, and some things still cooling off the
          printer.
        </p>
        <div className="row filters" role="group" aria-label="Filter games">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="chip"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="grid">
          {shelfGames(filter).map((g) => (
            <GameCard key={g.slug} game={g} />
          ))}
        </div>
      </div>
    </section>
  );
}
