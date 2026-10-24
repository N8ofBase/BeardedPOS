import { Link } from "react-router";
import { useReviewsFor } from "../api/data.tsx";
import { ReviewCard } from "../components/ReviewList.tsx";

/** Reviews the team picked as featured. Hidden until there are some. */
export function WhatPlayersSay() {
  const featured = useReviewsFor()
    .filter((r) => r.featured)
    .slice(0, 3);
  if (featured.length === 0) return null;
  return (
    <section className="players">
      <div className="wrap pad">
        <h2>What players say.</h2>
        <div className="reviews">
          {featured.map((r) => (
            <ReviewCard key={r.id} review={r} showGame />
          ))}
        </div>
        <Link className="btn" to="/reviews">
          Read all reviews
        </Link>
      </div>
    </section>
  );
}
