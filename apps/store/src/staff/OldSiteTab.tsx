// Everything copied from the old Squarespace site, for the team to mark keep, update or drop before
// any of it goes on the new site.
import { useEffect, useState } from "react";
import {
  NOTE_MAX,
  oldSite,
  type OldSiteChoice,
  type OldSiteDecision,
  type OldSiteItem,
} from "@bearded/store-core";
import { errorText, useStore, type Loadable } from "../api/store.ts";

const LABELS: Record<OldSiteDecision, string> = { keep: "Keep", update: "Update", drop: "Drop" };
type Filter = "all" | "open" | OldSiteDecision;
const FILTERS: [Filter, string][] = [
  ["all", "Everything"],
  ["open", "Not decided"],
  ["keep", "Keep"],
  ["update", "Update"],
  ["drop", "Drop"],
];

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const total = oldSite.reduce((n, p) => n + p.items.length, 0);

export function OldSiteTab() {
  const store = useStore();
  const [choices, setChoices] = useState<Loadable<Map<string, OldSiteChoice>>>({ state: "loading" });
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let live = true;
    store.staff.oldSite().then(
      (list) => live && setChoices({ state: "ready", value: new Map(list.map((c) => [c.itemId, c])) }),
      () => live && setChoices({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [store]);

  if (choices.state === "loading") return <p>Loading the old site…</p>;
  if (choices.state === "failed") return <p>We couldn’t load your choices. Refresh the page to try again.</p>;
  const map = choices.value;
  const saved = (c: OldSiteChoice) => setChoices({ state: "ready", value: new Map(map).set(c.itemId, c) });
  const shows = (item: OldSiteItem) => {
    const d = map.get(item.id)?.decision;
    return filter === "all" || (filter === "open" ? !d : d === filter);
  };
  const pages = oldSite
    .map((p) => ({ ...p, items: p.items.filter(shows) }))
    .filter((p) => p.items.length > 0);

  return (
    <div className="old-site">
      <p className="hint">
        Everything from the Squarespace site at beardedboardgames.com. Mark each item Keep, Update or Drop. A
        note saves with the choice. Nothing here is on the new site until you decide. {map.size} of {total}{" "}
        decided.
      </p>
      <div className="row filters" role="group" aria-label="Show items">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {pages.length === 0 && <p>Nothing here.</p>}
      {pages.map((page) => (
        <section key={page.path} className="old-page">
          <h2>
            {page.title} <span className="path">beardedboardgames.com{page.path}</span>
          </h2>
          <ul className="staff-list">
            {page.items.map((item) => (
              <OldItem key={item.id} item={item} choice={map.get(item.id)} onSaved={saved} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function OldItem({
  item,
  choice,
  onSaved,
}: {
  item: OldSiteItem;
  choice: OldSiteChoice | undefined;
  onSaved: (c: OldSiteChoice) => void;
}) {
  const store = useStore();
  const [note, setNote] = useState(choice?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(decision: OldSiteDecision) {
    setBusy(true);
    setError("");
    try {
      onSaved(await store.staff.chooseOldSite(item.id, decision, note));
    } catch (e) {
      setError(errorText(e, "That didn’t save. Try again in a minute."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`review old-item ${choice ? `is-${choice.decision}` : ""}`}>
      <h3>{item.title}</h3>
      {item.text && <blockquote>{item.text}</blockquote>}
      {item.images && (
        <div className="thumbs">
          {item.images.map((img) => (
            <a key={img.src} href={img.src} target="_blank" rel="noopener">
              <img src={`${img.src}?format=300w`} alt={img.alt} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {item.links && (
        <p className="links">
          {item.links.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener">
              {l.label}
            </a>
          ))}
        </p>
      )}
      <p className="suggest">
        <strong>Idea:</strong> {item.suggestion}
      </p>
      <label htmlFor={`note-${item.id}`}>Note</label>
      <textarea
        id={`note-${item.id}`}
        rows={2}
        maxLength={NOTE_MAX}
        value={note}
        placeholder="What to change, or why"
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="row-actions" role="group" aria-label={`Decide: ${item.title}`}>
        {(Object.keys(LABELS) as OldSiteDecision[]).map((d) => (
          <button
            key={d}
            type="button"
            className={choice?.decision === d ? "btn go" : "btn"}
            aria-pressed={choice?.decision === d}
            disabled={busy}
            onClick={() => choose(d)}
          >
            {LABELS[d]}
          </button>
        ))}
      </div>
      {choice && (
        <p className="who">
          {LABELS[choice.decision]} · {choice.by} · {when.format(new Date(choice.at))}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
