import { useInfiniteQuery } from "@tanstack/react-query";
import { formatMoney, STATUS_LABEL, type ApptStatus } from "@pet-pos/core";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { NoteView } from "../grooming/Notes.tsx";

/** Each groom for this pet, newest first, with the groomer's notes and photos. */
export function PetGroomingHistory({ petId }: { petId: string }) {
  const { api } = useSession();
  const h = useInfiniteQuery({
    queryKey: ["petGroomingHistory", petId],
    queryFn: ({ pageParam }) => api.call("petGroomingHistory", { petId, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  });
  const grooms = (h.data?.pages ?? []).flatMap((p) => p.grooms);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <h3 style={{ margin: 0 }}>Grooming history</h3>
      {h.isError && <p className="error-box">{errorMessage(h.error)}</p>}
      {h.data && grooms.length === 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          No grooms yet.
        </p>
      )}
      {grooms.map((g) => (
        <article
          key={g.appointmentId}
          className="mycard"
          aria-label={`Groom on ${new Date(g.date).toLocaleDateString()}`}
        >
          <span>
            <b>
              {new Date(g.date).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </b>{" "}
            · {g.label} · {g.groomerName} · {formatMoney(g.priceCents)}
            {g.status !== "done" && (
              <span className={`chip ${g.status}`}> {STATUS_LABEL[g.status as ApptStatus]}</span>
            )}
            {g.receiptNumber && <span className="muted"> · receipt #{g.receiptNumber}</span>}
          </span>
          {g.notes.map((n) => (
            <NoteView key={n.id} n={n} />
          ))}
          {g.notes.length === 0 && <span className="muted small">No notes.</span>}
        </article>
      ))}
      {h.hasNextPage && (
        <div>
          <button type="button" onClick={() => void h.fetchNextPage()} disabled={h.isFetchingNextPage}>
            Show older grooms
          </button>
        </div>
      )}
    </div>
  );
}
