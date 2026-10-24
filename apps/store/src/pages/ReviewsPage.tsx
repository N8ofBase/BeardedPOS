import { useState } from "react";
import { useReviews } from "../api/data.tsx";
import { ReviewForm } from "../components/ReviewForm.tsx";
import { ReviewList } from "../components/ReviewList.tsx";
import { games } from "../content/site.ts";

export function ReviewsPage() {
  const reviews = useReviews();
  const [game, setGame] = useState("");
  const shown = reviews.state === "ready" ? reviews.value.filter((r) => !game || r.game === game) : [];
  return (
    <section className="wrap pad reviews-page">
      <h1>Please give us a review.</h1>
      <p className="lede">
        Played one of our games? Tell us, and tell the next family deciding what to play tonight.
      </p>
      <ReviewForm />
      <h2 className="all-reviews">What players say</h2>
      <div className="row filters" role="group" aria-label="Show reviews for">
        <button type="button" className="chip" aria-pressed={game === ""} onClick={() => setGame("")}>
          All games
        </button>
        {games.map((g) => (
          <button
            key={g.slug}
            type="button"
            className="chip"
            aria-pressed={game === g.slug}
            onClick={() => setGame(g.slug)}
          >
            {g.name}
          </button>
        ))}
      </div>
      {reviews.state === "loading" && <p>Loading reviews…</p>}
      {reviews.state === "failed" && <p>We couldn’t load reviews just now. Refresh the page to try again.</p>}
      {reviews.state === "ready" && (
        <ReviewList reviews={shown} showGame empty="No reviews here yet. Be the first." />
      )}
    </section>
  );
}
