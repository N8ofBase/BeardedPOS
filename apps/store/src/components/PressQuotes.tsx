import type { Game } from "../content/site.ts";

/** Quotes from published reviews of a game, each linking to the review. */
export function PressQuotes({ game, showGame = false }: { game: Game; showGame?: boolean }) {
  if (!game.press) return null;
  return (
    <div className="press">
      <div className="quotes">
        {game.press.quotes.map((q) => (
          <blockquote key={q.quote}>
            <p>{q.quote}</p>
            <footer>
              <a href={q.href} target="_blank" rel="noopener">
                {q.who}
              </a>
              {showGame && <span className="on"> on {game.name}</span>}
            </footer>
          </blockquote>
        ))}
      </div>
      <p className="links">
        More reviews:{" "}
        {game.press.more.map((l, i) => (
          <span key={l.href}>
            {i > 0 && " · "}
            <a href={l.href} target="_blank" rel="noopener">
              {l.label}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}
