import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../session.tsx";
import { ConfirmTyped } from "../../ui/ConfirmTyped.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";

/** The prototype's delete warning: says exactly what goes and what stays, then asks for "delete". */
export function DeleteCustomer({ id, onDone }: { id: string; onDone: (deleted: boolean) => void }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const preview = useQuery({
    queryKey: ["delete-preview", id],
    queryFn: () => api.call("deletePreview", { id }),
  });

  if (preview.isPending) return <p className="muted">Checking what this removes…</p>;
  if (preview.isError) return <p className="error-box">{errorMessage(preview.error)}</p>;
  const p = preview.data;
  const pets = p.petNames.length ? ` and their pets (${p.petNames.join(", ")})` : "";
  const cards = p.punchCards ? `, ${p.punchCards} Astro punch card${p.punchCards > 1 ? "s" : ""}` : "";

  return (
    <ConfirmTyped
      title={`Delete ${p.name}?`}
      button="Delete customer"
      onCancel={() => onDone(false)}
      onConfirm={async () => {
        try {
          await api.call("deleteCustomer", { id });
          toast(`${p.name} deleted`);
          qc.removeQueries({ queryKey: ["customer", id] });
          void qc.invalidateQueries({ queryKey: ["customers"] });
          onDone(true);
        } catch (err) {
          toast(errorMessage(err));
        }
      }}
    >
      <p>
        This permanently removes {p.name}
        {pets}, their contact details{cards}
        {p.vaccinations ? " and vaccination records" : ""}. It can't be undone.
      </p>
      <p className="muted">
        Past sales stay in Sales, without a customer attached. Punch balances held in Astro itself aren't
        affected.
      </p>
    </ConfirmTyped>
  );
}
