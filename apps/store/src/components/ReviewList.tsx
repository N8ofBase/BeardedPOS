import { Link } from "react-router";
import { games } from "../content/site.ts";
import type { Review } from "@bearded/store-core";
import { gamePath } from "../roll.ts";
import { Stars } from "./Stars.tsx";

const day = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function ReviewCard({ review, showGame }: { review: Review; showGame?: boolean }) {
  const game = games.find((g) => g.slug === review.game);
  return (
    <article className="review">
      <Stars value={review.stars} />
      {review.headline && <h3>{review.headline}</h3>}
      <p>{review.body}</p>
      <p className="who">
        {review.name}
        {review.boughtFromUs && <span className="tag">Bought from us</span>}
        <span className="when"> · {day.format(new Date(review.date))}</span>
        {showGame && game && (
          <>
            {" · "}
            <Link to={gamePath(game.slug)}>{game.name}</Link>
          </>
        )}
      </p>
    </article>
  );
}

export function ReviewList({
  reviews,
  showGame,
  empty,
}: {
  reviews: Review[];
  showGame?: boolean;
  empty: string;
}) {
  if (reviews.length === 0) return <p className="none">{empty}</p>;
  return (
    <div className="reviews">
      {reviews.map((r) => (
        <ReviewCard key={r.id} review={r} showGame={showGame} />
      ))}
    </div>
  );
}
