import { Navigate, useLocation } from "react-router";
import { oldSiteRedirect } from "@bearded/store-core";

/** Old Squarespace links land on their new page; anything else gets the friendly 404. */
export function NotFound() {
  const to = oldSiteRedirect(useLocation().pathname);
  if (to) return <Navigate to={to} replace />;
  return (
    <section className="wrap pad">
      <h1>Rolled a 1.</h1>
      <p className="lede">That page isn’t here. It may have moved, or the link has a typo.</p>
      <a className="btn go" href="/">
        Back to the games
      </a>
    </section>
  );
}
