import { useEffect, useState } from "react";
import { formatCents, type Count, type StoreStats } from "@bearded/store-core";
import { useStore, type Loadable } from "../api/store.ts";
import { games } from "../content/site.ts";

const RANGES = [7, 30, 90];
const when = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const gameName = (slug: string) => games.find((g) => g.slug === slug)?.name ?? slug;
const pageName = (path: string) =>
  path === "/" ? "Home" : path.startsWith("/games/") ? gameName(path.slice(7)) : path;

export function StatsTab() {
  const store = useStore();
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Loadable<StoreStats>>({ state: "loading" });

  useEffect(() => {
    let live = true;
    store.staff.stats(days).then(
      (value) => live && setStats({ state: "ready", value }),
      () => live && setStats({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [store, days]);

  return (
    <div className="staff-stats">
      <div className="row filters" role="group" aria-label="Time range">
        {RANGES.map((d) => (
          <button
            key={d}
            type="button"
            className="chip"
            aria-pressed={days === d}
            onClick={() => {
              setStats({ state: "loading" });
              setDays(d);
            }}
          >
            Last {d} days
          </button>
        ))}
      </div>
      {stats.state === "loading" && <p>Counting…</p>}
      {stats.state === "failed" && <p>We couldn’t load stats. Refresh the page to try again.</p>}
      {stats.state === "ready" && <Stats s={stats.value} />}
      <p className="hint">
        Counted by the store itself, with no Google Analytics. Visitors are a random id per browser, with no
        names or emails, and browsers that ask not to be tracked aren’t. Activity older than 13 months is
        deleted.
      </p>
    </div>
  );
}

function Stats({ s }: { s: StoreStats }) {
  const tiles: [string, string][] = [
    ["Visitors", s.visitors.toLocaleString()],
    ["Page views", s.pageViews.toLocaleString()],
    ["Added to cart", s.cartAdds.toLocaleString()],
    ["Checkouts started", s.checkoutsStarted.toLocaleString()],
    ["Orders paid", s.ordersPaid.toLocaleString()],
    ["Paid (before tax)", formatCents(s.paidCents)],
  ];
  return (
    <>
      <dl className="tiles">
        {tiles.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="left-carts">
        <h2 id="left-carts">Left in carts</h2>
        <p className="hint">
          Carts with items and no paid order, quiet for a day or more. Anonymous, so there’s no one to email;
          use it to see what people hesitate on.
        </p>
        {s.leftCarts.length === 0 ? (
          <p>No carts left behind in this range.</p>
        ) : (
          <table className="left-carts">
            <thead>
              <tr>
                <th scope="col">Last activity</th>
                <th scope="col">Items</th>
                <th scope="col">Stopped at</th>
              </tr>
            </thead>
            <tbody>
              {s.leftCarts.map((c) => (
                <tr key={c.visitorId}>
                  <td>{when.format(new Date(c.lastActivity))}</td>
                  <td>{c.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</td>
                  <td>{c.stoppedAt === "checkout" ? "Square checkout" : "Cart"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="ranks">
        <Ranked title="Most clicks" rows={s.topClicks} />
        <Ranked
          title="Most-viewed games"
          rows={s.topGames.map((r) => ({ ...r, label: gameName(r.label) }))}
        />
        <Ranked title="Added to cart" rows={s.addsByProduct} />
        <Ranked title="Top pages" rows={s.topPages.map((r) => ({ ...r, label: pageName(r.label) }))} />
        <Ranked title="Where visitors came from" rows={s.sources} />
        <section className="ranked" aria-labelledby="extras">
          <h2 id="extras">VIP and the rest</h2>
          <dl className="pairs">
            <dt>VIP signups</dt>
            <dd>{s.vipJoins}</dd>
            <dt>VIP popup shown</dt>
            <dd>{s.popup.shown}</dd>
            <dt>Joined from the popup</dt>
            <dd>{s.popup.joined}</dd>
            <dt>Closed the popup</dt>
            <dd>{s.popup.closed}</dd>
            <dt>Reviews sent</dt>
            <dd>{s.reviewsSent}</dd>
            <dt>Dice rolls</dt>
            <dd>{s.rolls}</dd>
          </dl>
        </section>
      </div>
    </>
  );
}

/** A ranked list with a bar per row, scaled to the top row. Numbers are always printed. */
function Ranked({ title, rows }: { title: string; rows: Count[] }) {
  const top = Math.max(1, ...rows.map((r) => r.count));
  const id = `rank-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="ranked" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {rows.length === 0 ? (
        <p className="hint">Nothing yet.</p>
      ) : (
        <ol>
          {rows.map((r) => (
            <li key={r.label} title={`${r.label}: ${r.count}`}>
              <span className="label">{r.label}</span>
              <span className="count">{r.count.toLocaleString()}</span>
              <span className="bar" aria-hidden="true" style={{ width: `${(r.count / top) * 100}%` }} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
