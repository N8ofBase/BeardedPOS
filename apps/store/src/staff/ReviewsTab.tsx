import { useCallback, useEffect, useState } from "react";
import type { ReviewAction, StaffReview } from "@bearded/store-core";
import { errorText, useStore, type Loadable } from "../api/store.ts";
import { Stars } from "../components/Stars.tsx";
import { games } from "../content/site.ts";

type Status = StaffReview["status"];

const FILTERS: [Status, string][] = [
  ["pending", "Waiting"],
  ["approved", "On the site"],
  ["hidden", "Hidden"],
];

const ACTIONS: Record<Status, [ReviewAction, string][]> = {
  pending: [
    ["approve", "Approve"],
    ["feature", "Approve and feature"],
    ["hide", "Hide"],
  ],
  approved: [
    ["feature", "Feature"],
    ["hide", "Hide"],
  ],
  hidden: [["approve", "Put on the site"]],
};

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export function ReviewsTab() {
  const store = useStore();
  const [status, setStatus] = useState<Status>("pending");
  const [reviews, setReviews] = useState<Loadable<StaffReview[]>>({ state: "loading" });
  const [error, setError] = useState("");

  const load = useCallback(
    (s: Status) =>
      store.staff.reviews(s).then(
        (value) => setReviews({ state: "ready", value }),
        () => setReviews({ state: "failed" }),
      ),
    [store],
  );

  useEffect(() => {
    void load(status);
  }, [load, status]);

  async function act(r: StaffReview, action: ReviewAction) {
    setError("");
    try {
      await store.staff.moderate(r.id, action);
      await load(status);
    } catch (e) {
      setError(errorText(e, "That didn’t save. Try again in a minute."));
    }
  }

  return (
    <div className="staff-reviews">
      <p className="hint">
        Reviews show on the site only after someone approves them. Featured reviews go on the home page.
      </p>
      <div className="row filters" role="group" aria-label="Show reviews">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={status === key}
            onClick={() => {
              setReviews({ state: "loading" });
              setStatus(key);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {reviews.state === "loading" && <p>Loading reviews…</p>}
      {reviews.state === "failed" && <p>We couldn’t load reviews. Refresh the page to try again.</p>}
      {reviews.state === "ready" && reviews.value.length === 0 && (
        <p>{status === "pending" ? "Nothing waiting. Nice work." : "No reviews here."}</p>
      )}
      {reviews.state === "ready" && (
        <ul className="staff-list">
          {reviews.value.map((r) => (
            <li key={r.id} className="review staff-review">
              <div className="top">
                <Stars value={r.stars} />
                <span className="game">{games.find((g) => g.slug === r.game)?.name ?? r.game}</span>
                {r.featured && <span className="tag">Featured</span>}
              </div>
              {r.headline && <h3>{r.headline}</h3>}
              <p>{r.body}</p>
              <p className="who">
                {r.name} · <a href={`mailto:${r.email}`}>{r.email}</a> · {when.format(new Date(r.createdAt))}
              </p>
              <div className="row-actions">
                {(r.featured && status === "approved"
                  ? ACTIONS.approved.map(([a, l]): [ReviewAction, string] =>
                      a === "feature" ? ["unfeature", "Stop featuring"] : [a, l],
                    )
                  : ACTIONS[status]
                ).map(([action, label]) => (
                  <button
                    key={action}
                    type="button"
                    className={action === "hide" ? "btn" : "btn go"}
                    onClick={() => act(r, action)}
                    aria-label={`${label}: review by ${r.name}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
