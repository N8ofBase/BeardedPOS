import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { can } from "@pet-pos/core";
import type { GroomingNote, PhotoInput } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";
import { resizePhoto } from "./photo.ts";

const MAX_PHOTOS = 6;

/** Write a note, with up to 6 Before / After photos (the camera on a phone). */
export function NoteForm({ appointmentId, onDone }: { appointmentId: string; onDone?: () => void }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [kind, setKind] = useState<"before" | "after">("before");
  const [busy, setBusy] = useState(false);

  const save = useMutation({
    mutationFn: () => api.call("addGroomingNote", { appointmentId, note, photos }),
    onSuccess: () => {
      toast("Note saved");
      setNote("");
      setPhotos([]);
      void qc.invalidateQueries({ queryKey: ["appointmentNotes", appointmentId] });
      void qc.invalidateQueries({ queryKey: ["groomingDay"] });
      void qc.invalidateQueries({ queryKey: ["petGroomingHistory"] });
      onDone?.();
    },
    onError: (err) => toast(errorMessage(err)),
  });

  async function pick(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    try {
      const room = MAX_PHOTOS - photos.length;
      const next: PhotoInput[] = [];
      for (const f of [...files].slice(0, room)) next.push({ kind, ...(await resizePhoto(f)) });
      setPhotos([...photos, ...next]);
      if (files.length > room) toast(`Up to ${MAX_PHOTOS} photos per note.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't read that photo.");
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8 }} aria-label="Grooming note">
      <label>
        Note
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Matted behind the ears, shaved short"
        />
      </label>
      <div className="actions" style={{ alignItems: "center" }}>
        <div className="seg" role="group" aria-label="Photo is">
          <button type="button" aria-pressed={kind === "before"} onClick={() => setKind("before")}>
            Before
          </button>
          <button type="button" aria-pressed={kind === "after"} onClick={() => setKind("after")}>
            After
          </button>
        </div>
        <label className="button" style={{ cursor: "pointer" }}>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            style={{ display: "none" }}
            disabled={busy || photos.length >= MAX_PHOTOS}
            onChange={(e) => {
              void pick(e.target.files);
              e.target.value = "";
            }}
            aria-label={`Add ${kind} photo`}
          />
          {busy ? "Resizing…" : `Add ${kind} photo`}
        </label>
      </div>
      {photos.length > 0 && (
        <div className="photos">
          {photos.map((p, i) => (
            <figure key={i}>
              <img src={p.data} alt={`${p.kind} photo ${i + 1}`} />
              <figcaption>
                {p.kind === "before" ? "Before" : "After"}{" "}
                <button
                  type="button"
                  className="link"
                  onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <div className="actions">
        <button className="primary" disabled={save.isPending || busy || (!note.trim() && !photos.length)}>
          Save note
        </button>
      </div>
    </form>
  );
}

/** One note with its photos. */
export function NoteView({ n, onDelete }: { n: GroomingNote; onDelete?: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span className="muted small">
        {n.staffName ?? "Someone"} ·{" "}
        {new Date(n.createdAt).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
        {n.canDelete && onDelete && (
          <>
            {" "}
            ·{" "}
            <button type="button" className="link" onClick={onDelete}>
              Delete
            </button>
          </>
        )}
      </span>
      {n.note && <span>{n.note}</span>}
      {n.photos.length > 0 && (
        <div className="photos">
          {n.photos.map((p) =>
            p.src ? (
              <figure key={p.id}>
                <button
                  type="button"
                  className="link"
                  onClick={() => setOpen(p.src)}
                  aria-label={`Open ${p.kind} photo`}
                >
                  <img src={p.src} alt={`${p.kind} photo`} />
                </button>
                <figcaption>{p.kind === "before" ? "Before" : "After"}</figcaption>
              </figure>
            ) : null,
          )}
        </div>
      )}
      {open && (
        <div className="scrim photo-view" onClick={() => setOpen(null)} role="dialog" aria-label="Photo">
          <img src={open} alt="Grooming photo" className="photo-full" />
        </div>
      )}
    </div>
  );
}

/** The notes on one appointment, with Add note for groomers and managers. */
export function AppointmentNotes({ appointmentId }: { appointmentId: string }) {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = can(me.staff.role, "grooming.notes");
  const [adding, setAdding] = useState(false);
  const notes = useQuery({
    queryKey: ["appointmentNotes", appointmentId],
    queryFn: () => api.call("appointmentNotes", { appointmentId }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.call("deleteGroomingNote", { id }),
    onSuccess: () => {
      toast("Note deleted");
      void qc.invalidateQueries({ queryKey: ["appointmentNotes", appointmentId] });
      void qc.invalidateQueries({ queryKey: ["petGroomingHistory"] });
    },
    onError: (err) => toast(errorMessage(err)),
  });

  return (
    <section style={{ display: "grid", gap: 8 }}>
      <h3 style={{ margin: 0 }}>Grooming notes</h3>
      {notes.data?.map((n) => (
        <NoteView key={n.id} n={n} onDelete={() => del.mutate(n.id)} />
      ))}
      {notes.data?.length === 0 && !adding && (
        <p className="muted small" style={{ margin: 0 }}>
          No notes yet.
        </p>
      )}
      {canWrite &&
        (adding ? (
          <NoteForm appointmentId={appointmentId} onDone={() => setAdding(false)} />
        ) : (
          <div>
            <button type="button" onClick={() => setAdding(true)}>
              Add note or photos
            </button>
          </div>
        ))}
    </section>
  );
}
