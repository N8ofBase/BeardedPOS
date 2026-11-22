// Behind the Beard's "Site content" tab: change the site's words and pictures, save a draft, look at
// it as shoppers will, then publish. Game items, prices and stock still come from Square.
import { useEffect, useState, type ChangeEvent } from "react";
import {
  changedKeys,
  isImageId,
  SITE_STATUS_LABELS,
  SITE_STATUSES,
  siteGroups,
  siteValueProblem,
  type SiteContent,
  type SiteField,
  type SiteGroup,
  type StaffSite,
} from "@bearded/store-core";
import { errorText, useStore, type Loadable } from "../api/store.ts";
import { originals, pictureUrl } from "../content/editable.ts";

const when = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const at = (iso: string) => when.format(new Date(iso));
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const ORIGINAL = originals();

/** Longest side of a picture after shrinking; plenty for box art and banners. */
const MAX_SIDE = 1600;

/** Shrinks a photo in the browser so phone pictures upload quickly, and returns base64 to send. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  // WebP keeps transparency and is small; browsers that can't make WebP get a JPEG.
  let out = await blob("image/webp");
  if (!out || out.type !== "image/webp") out = await blob("image/jpeg");
  if (!out) throw new Error("couldn't shrink");
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("couldn't read"));
    reader.readAsDataURL(out);
  });
  return url.slice(url.indexOf(",") + 1);
}

export function SiteTab() {
  const store = useStore();
  const [site, setSite] = useState<Loadable<StaffSite>>({ state: "loading" });
  useEffect(() => {
    let live = true;
    store.staff.site().then(
      (value) => live && setSite({ state: "ready", value }),
      () => live && setSite({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [store]);
  if (site.state === "loading") return <p>Loading the site content…</p>;
  if (site.state === "failed")
    return <p>We couldn’t load the site content. Refresh the page to try again.</p>;
  return <Editor saved={site.value} onSaved={(value) => setSite({ state: "ready", value })} />;
}

function Editor({ saved, onSaved }: { saved: StaffSite; onSaved: (s: StaffSite) => void }) {
  const store = useStore();
  const original = ORIGINAL;
  const [draft, setDraft] = useState<SiteContent>(saved.draft);
  const [groupId, setGroupId] = useState(siteGroups[0]!.id);
  const [busy, setBusy] = useState<"" | "save" | "preview" | "publish" | "restore">("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const unsaved = changedKeys(draft, saved.draft).length > 0;
  const notLive = changedKeys(draft, saved.published);
  const problems = siteGroups.flatMap((g) =>
    g.fields.flatMap((f) => {
      const v = draft[f.key];
      const p = v === undefined ? null : siteValueProblem(f, v);
      return p ? [{ group: g, problem: p }] : [];
    }),
  );
  const group = siteGroups.find((g) => g.id === groupId)!;
  const groupChanged = (g: SiteGroup) => g.fields.some((f) => draft[f.key] !== saved.published[f.key]);

  /** Sets a field; a value back at the original drops the change. */
  const set = (key: string, value: string) => {
    setMessage("");
    setConfirming(false);
    setDraft((d) => {
      const next = { ...d };
      if (value === original[key]) delete next[key];
      else next[key] = value;
      return next;
    });
  };
  const resetField = (key: string) =>
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });

  async function run(kind: typeof busy, work: () => Promise<StaffSite>, done: string) {
    setBusy(kind);
    setError("");
    setMessage("");
    try {
      const next = await work();
      onSaved(next);
      setDraft(next.draft);
      setMessage(done);
      return true;
    } catch (e) {
      setError(errorText(e, "That didn’t save. Check your connection and try again."));
      return false;
    } finally {
      setBusy("");
      setConfirming(false);
    }
  }

  const save = () =>
    run("save", () => store.staff.saveSite(draft), "Draft saved. Shoppers don’t see it yet.");

  async function preview() {
    // Open the tab now (browsers block it after a wait), then save and point it at the draft.
    const tab = window.open("about:blank", "_blank");
    const okay = unsaved
      ? await run("preview", () => store.staff.saveSite(draft), "Draft saved and opened in a new tab.")
      : true;
    if (!okay) return tab?.close();
    const page = group.page.includes("#")
      ? group.page.replace("#", "?preview=draft#")
      : `${group.page}?preview=draft`;
    if (tab) tab.location.href = page;
    else window.location.href = page;
  }

  async function publish() {
    if (unsaved) {
      const okay = await run("publish", () => store.staff.saveSite(draft), "");
      if (!okay) return;
    }
    await run(
      "publish",
      () => store.staff.publishSite(),
      "Published. Shoppers see the changes the next time they open or refresh a page.",
    );
  }

  return (
    <div className="site-editor">
      <p className="hint">
        Change the words and pictures on the store. Save a draft as you go, preview it, then publish when it
        looks right. Prices, stock and what’s for sale still come from Square.
      </p>

      <div className="site-status panel">
        <p>
          <strong>Live site:</strong>{" "}
          {saved.publishedAt
            ? `published ${at(saved.publishedAt)} by ${saved.publishedBy}.`
            : "the original wording. Nothing has been published from here yet."}
        </p>
        <p>
          <strong>Your draft:</strong>{" "}
          {notLive.length === 0
            ? "the same as the live site."
            : `${plural(notLive.length, "change")} not live yet${unsaved ? ", some not saved" : ""}.`}
        </p>
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={!unsaved || !!busy || problems.length > 0}
            onClick={save}
          >
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!!busy || problems.length > 0}
            onClick={() => void preview()}
          >
            {busy === "preview" ? "Saving…" : "Preview this page"}
          </button>
          <button
            type="button"
            className="btn go"
            disabled={notLive.length === 0 || !!busy || problems.length > 0}
            onClick={() => setConfirming(true)}
          >
            Publish…
          </button>
          {unsaved && (
            <button type="button" className="link" onClick={() => setDraft(saved.draft)} disabled={!!busy}>
              Undo changes since the last save
            </button>
          )}
        </div>
        {confirming && (
          <div className="confirm" role="alertdialog" aria-label="Publish to the live store">
            <p>
              Publish {plural(notLive.length, "change")} to the live store? Shoppers see them the next time
              they open or refresh a page.
            </p>
            <div className="row">
              <button type="button" className="btn go" onClick={() => void publish()} disabled={!!busy}>
                {busy === "publish" ? "Publishing…" : "Yes, publish"}
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                Not yet
              </button>
            </div>
          </div>
        )}
        {problems.length > 0 && (
          <p className="error" role="alert">
            Fix this first ({problems[0]!.group.title}): {problems[0]!.problem}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </div>

      <label htmlFor="site-part" className="site-part-label">
        Part of the site
      </label>
      <select id="site-part" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
        {siteGroups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.title}
            {groupChanged(g) ? " (not live yet)" : ""}
          </option>
        ))}
      </select>

      <section className="site-group" aria-label={group.title}>
        {group.fields.map((f) => (
          <FieldEditor
            key={f.key}
            field={f}
            value={draft[f.key] ?? original[f.key] ?? ""}
            original={original[f.key] ?? ""}
            changed={draft[f.key] !== undefined}
            notLive={draft[f.key] !== saved.published[f.key]}
            onChange={(v) => set(f.key, v)}
            onOriginal={() => resetField(f.key)}
          />
        ))}
      </section>

      {saved.history.length > 0 && (
        <section className="site-history">
          <h2>Earlier versions</h2>
          <p className="hint">
            Putting one back only changes your draft. Preview it, then publish to make it live again.
          </p>
          <ul className="staff-list">
            {saved.history.map((v, i) => (
              <li key={v.id}>
                {at(v.at)} by {v.by}, {plural(v.changes, "change")}
                {i === 0 && " (live now)"}{" "}
                <button
                  type="button"
                  className="link"
                  disabled={!!busy || unsaved}
                  title={unsaved ? "Save or undo your changes first." : undefined}
                  onClick={() =>
                    void run(
                      "restore",
                      () => store.staff.restoreSite(v.id),
                      `Your draft is now the version from ${at(v.at)}. Preview it, then publish.`,
                    )
                  }
                >
                  Put this version in my draft
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface FieldProps {
  field: SiteField;
  value: string;
  original: string;
  changed: boolean;
  notLive: boolean;
  onChange(v: string): void;
  onOriginal(): void;
}

function FieldEditor({ field, value, original, changed, notLive, onChange, onOriginal }: FieldProps) {
  const id = `site-${field.key.replace(/\./g, "-")}`;
  const problem = changed ? siteValueProblem(field, value) : null;
  const tags = (
    <>
      {notLive && <span className="tag soon">Not live yet</span>}
      {changed && (
        <button type="button" className="link" onClick={onOriginal}>
          Use the original
        </button>
      )}
    </>
  );
  return (
    <div className="site-field">
      <div className="site-field-head">
        <label id={`${id}-label`} htmlFor={field.kind === "choice" ? undefined : id}>
          {field.label}
        </label>
        {tags}
      </div>
      {field.kind === "image" ? (
        <ImageField id={id} field={field} value={value} original={original} onChange={onChange} />
      ) : field.kind === "status" ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {SITE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SITE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      ) : field.kind === "choice" ? (
        <div className="site-choices" role="radiogroup" aria-labelledby={`${id}-label`}>
          {field.choices?.map((c) => (
            <label key={c.value} className={value === c.value ? "on" : undefined}>
              <input
                type="radio"
                name={id}
                value={c.value}
                checked={value === c.value}
                onChange={() => onChange(c.value)}
              />
              {c.label}
            </label>
          ))}
        </div>
      ) : field.kind === "text" || field.kind === "lines" ? (
        <textarea
          id={id}
          value={value}
          rows={Math.min(14, Math.max(3, Math.ceil(value.length / 70) + value.split("\n").length))}
          maxLength={field.max}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type={field.kind === "email" ? "email" : field.kind === "url" ? "url" : "text"}
          value={value}
          maxLength={field.max}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.hint && <p className="hint">{field.hint}</p>}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

function ImageField({
  id,
  field,
  value,
  original,
  onChange,
}: {
  id: string;
  field: SiteField;
  value: string;
  original: string;
  onChange(v: string): void;
}) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const src = isImageId(value) ? pictureUrl(value, original) : value;

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Pick a photo or picture file.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { id: imageId } = await store.staff.uploadImage(await shrink(file));
      onChange(imageId);
    } catch (err) {
      setError(errorText(err, "That picture didn’t upload. Try again, or try a different picture."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-image">
      {src ? (
        <img src={src} alt={`Current ${field.label.toLowerCase()}`} />
      ) : (
        <p className="hint">No picture yet.</p>
      )}
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => void choose(e)}
        disabled={busy}
      />
      {busy && <p role="status">Shrinking and uploading…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
