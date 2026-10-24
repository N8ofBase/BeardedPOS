// Customer relationship pieces: tag chips and the tag picker, the follow-up box and the
// timeline on a profile.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { addDays, cleanTagName, formatDate, KIND_LABEL, todayIso, type CustomerKind } from "@pet-pos/core";
import type { TagChip, TimelineKind } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";

export function TagChips({ tags, kind }: { tags: TagChip[]; kind?: CustomerKind }) {
  if (!tags.length && kind !== "retailer") return null;
  return (
    <span className="chips">
      {kind === "retailer" && <span className="tag retailer">{KIND_LABEL.retailer}</span>}
      {tags.map((t) => (
        <span key={t.id} className="tag muted">
          {t.name}
        </span>
      ))}
    </span>
  );
}

/** Pick tags by name; typing a new name and pressing Enter adds it. */
export function TagPicker({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const { api } = useSession();
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.call("listTags") });
  const [text, setText] = useState("");
  const has = (n: string) => value.some((v) => v.toLowerCase() === n.toLowerCase());

  function add(name: string) {
    const clean = cleanTagName(name);
    if (!clean || has(clean)) return setText("");
    const known = tags.data?.find((t) => t.name.toLowerCase() === clean.toLowerCase());
    onChange([...value, known?.name ?? clean]);
    setText("");
  }

  const suggestions = (tags.data ?? []).filter((t) => !has(t.name));
  return (
    <div className="tag-picker">
      <span className="chips">
        {value.map((t) => (
          <span key={t} className="tag muted">
            {t}{" "}
            <button
              type="button"
              className="chip-x"
              aria-label={`Remove ${t}`}
              onClick={() => onChange(value.filter((v) => v !== t))}
            >
              ×
            </button>
          </span>
        ))}
      </span>
      <input
        list="tag-names"
        placeholder="Add a tag, like VIP or Kickstarter backer"
        aria-label="Add a tag"
        value={text}
        maxLength={40}
        onChange={(e) => {
          const v = e.target.value;
          // Picking from the list adds it right away.
          if (suggestions.some((s) => s.name === v)) add(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(text);
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
      <datalist id="tag-names">
        {suggestions.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>
    </div>
  );
}

export function FollowUpBox({
  customerId,
  on,
  note,
  canEdit,
}: {
  customerId: string;
  on: string | null;
  note: string | null;
  canEdit: boolean;
}) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(on ?? "");
  const [text, setText] = useState(note ?? "");
  const save = useMutation({
    mutationFn: (v: { on: string | null; note: string }) => api.call("setFollowUp", { customerId, ...v }),
    onSuccess: (_r, v) => {
      toast(v.on ? "Follow-up saved" : "Follow-up cleared");
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["customer", customerId] });
      void qc.invalidateQueries({ queryKey: ["timeline", customerId] });
      void qc.invalidateQueries({ queryKey: ["follow-ups"] });
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const overdue = on && on < todayIso();

  return (
    <section className="panel">
      <h2>Follow-up</h2>
      {!editing && (
        <>
          {on ? (
            <p>
              <span className={overdue ? "tag low" : "tag ok"}>{overdue ? "Overdue" : "Due"}</span>{" "}
              {formatDate(on)}
              {note && <> · {note}</>}
            </p>
          ) : (
            <p className="muted">No follow-up set.</p>
          )}
          {canEdit && (
            <div className="actions">
              <button type="button" onClick={() => setEditing(true)}>
                {on ? "Change" : "Set a follow-up"}
              </button>
              {on && (
                <button
                  type="button"
                  onClick={() => save.mutate({ on: null, note: "" })}
                  disabled={save.isPending}
                >
                  Done, clear it
                </button>
              )}
            </div>
          )}
        </>
      )}
      {editing && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ on: date || null, note: text });
          }}
        >
          <label>
            Date
            <input type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            What to do
            <input
              value={text}
              maxLength={200}
              placeholder="Ask about the holiday reorder"
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="actions">
            <button className="primary" type="submit" disabled={save.isPending}>
              Save follow-up
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

const KIND_TEXT: Record<TimelineKind, string> = {
  note: "Note",
  vip_signup: "VIP signup",
  review: "Review",
  order: "Online order",
  email: "Email",
  unsubscribed: "Email off",
  follow_up: "Follow-up",
  sale: "Purchase",
};

export function Timeline({ customerId, canEdit }: { customerId: string; canEdit: boolean }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const timeline = useQuery({
    queryKey: ["timeline", customerId],
    queryFn: () => api.call("customerTimeline", { customerId }),
  });
  const [note, setNote] = useState("");
  const add = useMutation({
    mutationFn: () => api.call("addCustomerNote", { customerId, text: note }),
    onSuccess: () => {
      setNote("");
      void qc.invalidateQueries({ queryKey: ["timeline", customerId] });
    },
    onError: (err) => toast(errorMessage(err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (note.trim()) add.mutate();
  }

  return (
    <section className="panel">
      <h2>Timeline</h2>
      {canEdit && (
        <form onSubmit={submit} className="note-form">
          <textarea
            rows={2}
            placeholder="Add a note, like what they asked about"
            aria-label="New note"
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit" disabled={add.isPending || !note.trim()}>
            Add note
          </button>
        </form>
      )}
      {timeline.isError && <p className="error-box">{errorMessage(timeline.error)}</p>}
      {timeline.data?.length === 0 && <p className="muted">Nothing here yet.</p>}
      <ol className="timeline">
        {timeline.data?.map((e) => (
          <li key={`${e.kind}-${e.id}`}>
            <span className="small muted">
              {e.at.toLocaleDateString()} · {KIND_TEXT[e.kind]}
              {e.staffName && ` · ${e.staffName}`}
            </span>
            <span style={{ whiteSpace: "pre-wrap" }}>{e.summary}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Follow-ups due in the next week (and any overdue), on top of the customer list. */
export function FollowUpsDue({ onOpen }: { onOpen: (id: string) => void }) {
  const { api } = useSession();
  const list = useQuery({ queryKey: ["follow-ups"], queryFn: () => api.call("followUps") });
  const today = todayIso();
  const soon = addDays(today, 7);
  const due = (list.data ?? []).filter((f) => f.on <= soon);
  if (!due.length) return null;
  return (
    <section className="panel">
      <h2>Follow-ups this week</h2>
      <ul className="plain">
        {due.map((f) => (
          <li key={f.id}>
            <span className={f.on < today ? "tag low" : "tag ok"}>
              {f.on < today ? "Overdue" : formatDate(f.on)}
            </span>{" "}
            <button type="button" className="link" onClick={() => onOpen(f.id)}>
              {f.company ? `${f.company} (${f.name})` : f.name}
            </button>
            {f.note && <span className="muted"> · {f.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
