import { useEffect, useRef, type CSSProperties } from "react";
import { Link, useParams } from "react-router";
import { useProducts, useReviewsFor } from "../api/data.tsx";
import { ProductCard } from "../components/ProductCard.tsx";
import { ReviewForm } from "../components/ReviewForm.tsx";
import { ReviewList } from "../components/ReviewList.tsx";
import { VideoCard } from "../components/VideoCard.tsx";
import { Stars } from "../components/Stars.tsx";
import { brand, games, statusText } from "../content/site.ts";
import { averageStars } from "@bearded/store-core";
import { NotFound } from "./NotFound.tsx";

/** A short silent clip on a loop. It stays still, with controls, for people who ask for less motion. */
function LoopClip({ src, poster, caption }: { src: string; poster: string; caption: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const still =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    const video = ref.current;
    if (!video || still) return;
    // React sets `muted` as a property after the element exists, so autoplay alone can be blocked.
    video.muted = true;
    video.play().catch(() => {});
  }, [still]);
  return (
    <figure className="clip">
      <video
        ref={ref}
        src={src}
        poster={poster}
        controls={still}
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={caption}
      />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function GamePage() {
  const { slug } = useParams();
  const game = games.find((g) => g.slug === slug);
  const products = useProducts();
  const reviews = useReviewsFor(slug);
  if (!game) return <NotFound />;
  const rating = averageStars(reviews);
  const sheet = brand.sellSheets.find((s) => s.label === game.name);
  const mine = products.state === "ready" ? products.value.filter((p) => p.game === game.slug) : [];

  return (
    <article className="game-page" style={{ "--c": game.color } as CSSProperties}>
      {rating && (
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: game.name,
            brand: { "@type": "Brand", name: brand.name },
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: rating.average,
              reviewCount: rating.count,
            },
          })}
        </script>
      )}
      <header className="game-head">
        <div className="wrap">
          <div className="art">
            <img src={game.art} alt={`${game.name} box art`} />
          </div>
          <div>
            <p className="crumbs">
              <Link to="/#games">All games</Link>
            </p>
            <div className="tags">
              {game.labels.map((l) => (
                <span key={l} className={`tag ${l === "Prism Cortex" ? "pc" : ""}`}>
                  {l}
                </span>
              ))}
              {game.status !== "available" && <span className="tag soon">{statusText(game)}</span>}
              {game.badge && <span className="tag hot">{game.badge}</span>}
            </div>
            <h1>{game.name}</h1>
            <p className="lede">{game.tagline}</p>
            {rating ? (
              <p className="rating">
                <Stars value={rating.average} size="1.3rem" /> {rating.average} from {rating.count} review
                {rating.count === 1 ? "" : "s"}
              </p>
            ) : (
              <p className="rating none">No reviews yet</p>
            )}
            <ul className="facts">
              {game.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      </header>

      <section className="wrap pad about-game">
        <h2>How it plays</h2>
        <p>{game.blurb}</p>
        {game.story?.map((para) => (
          <p key={para}>{para}</p>
        ))}
        {(game.designer || game.artist) && (
          <p className="by">
            {[game.designer && `Designed by ${game.designer}`, game.artist && `art by ${game.artist}`]
              .filter(Boolean)
              .join(", ")}
          </p>
        )}
        {game.clip && <LoopClip {...game.clip} />}
        <p className="links">
          {game.links.rules && (
            <a href={game.links.rules} target="_blank" rel="noopener">
              Rules (PDF)
            </a>
          )}
          {game.links.bgg && (
            <a href={game.links.bgg} target="_blank" rel="noopener">
              BoardGameGeek
            </a>
          )}
          {sheet && (
            <a href={sheet.url} target="_blank" rel="noopener">
              Sell sheet for stores
            </a>
          )}
        </p>
      </section>

      {game.tutorial && (
        <section className="wrap pad learn">
          <h2>Learn to play</h2>
          <div className="videos">
            <VideoCard video={game.tutorial} />
          </div>
        </section>
      )}

      <section className="shop">
        <div className="wrap pad">
          <h2>Get {game.name}</h2>
          {products.state === "loading" && <p>Loading…</p>}
          {products.state === "failed" && (
            <p>We couldn’t load the shop just now. Refresh the page to try again.</p>
          )}
          {products.state === "ready" &&
            (mine.length > 0 ? (
              <div className="grid">
                {mine.map((p) => (
                  <ProductCard key={p.id} product={p} showGame={false} />
                ))}
              </div>
            ) : (
              <p>
                Not on sale yet. <Link to="/#vip">Join the VIP list</Link> to hear first.
              </p>
            ))}
        </div>
      </section>

      <section className="wrap pad game-reviews" id="reviews">
        <h2>Reviews</h2>
        <ReviewList reviews={reviews} empty={`No reviews of ${game.name} yet. Be the first.`} />
        <h3 className="write">Write a review</h3>
        <ReviewForm game={game.slug} />
      </section>
    </article>
  );
}
