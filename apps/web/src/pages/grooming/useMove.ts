import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clockText } from "@pet-pos/core";
import type { MoveResult } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage, fieldErrors } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";

/** Moving an appointment, with "Move anyway?" for warnings and Undo on the toast. */
export function useMove(onWarning: (w: PendingMove) => void) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["groomingDay"] });
    void qc.invalidateQueries({ queryKey: ["groomingWeek"] });
    void qc.invalidateQueries({ queryKey: ["customerAppointments"] });
  };
  return useMutation({
    mutationFn: (v: MoveInput) => api.call("moveAppointment", v),
    onSuccess: (r: MoveResult, v) => {
      refresh();
      if (v.undo) return toast("Moved back");
      toast(
        `Moved ${r.appointment.petName} to ${clockText(r.appointment.start)} with ${r.appointment.groomerName}`,
        {
          label: "Undo",
          onClick: () =>
            void api
              .call("moveAppointment", { id: r.appointment.id, ...r.from, override: true })
              .then(() => {
                refresh();
                toast("Moved back");
              })
              .catch((err: unknown) => toast(errorMessage(err))),
        },
      );
    },
    onError: (err, v) => {
      const w = fieldErrors(err).warnings;
      if (w && !v.override) return onWarning({ ...v, message: w });
      toast(errorMessage(err));
    },
  });
}

export interface MoveInput {
  id: string;
  staffId: string;
  day: string;
  start: number;
  override?: boolean;
  undo?: boolean;
}
export type PendingMove = MoveInput & { message: string };
