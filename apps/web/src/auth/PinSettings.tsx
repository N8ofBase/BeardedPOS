// Hosted only: setting PINs and the tablets set up for PIN sign-in. These go straight to /api/pos,
// not through the handler registry, because PINs are hashed on the server.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PIN_RULES, pinProblem } from "@bearded/core";
import { posFetch } from "../api/http.ts";
import { useSession } from "../session.tsx";
import { errorMessage } from "../ui/errors.ts";
import { SlideOver } from "../ui/SlideOver.tsx";
import { TwoTapButton } from "../ui/TwoTapButton.tsx";
import { useToast } from "../ui/Toast.tsx";

interface TabletListItem {
  id: string;
  name: string;
  setUpBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  thisTablet: boolean;
}

/** Sets a PIN: your own (no staffId) or, for owners and managers, someone else's. */
export function PinForm({
  staffId,
  hasPin,
  onSaved,
}: {
  staffId?: string;
  hasPin: boolean;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => posFetch("pin", { staffId, pin }),
    onSuccess: () => {
      toast(hasPin ? "PIN changed" : "PIN set");
      setPin("");
      setAgain("");
      void qc.invalidateQueries({ queryKey: ["pins"] });
      onSaved?.();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, PIN_RULES.maxDigits);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const problem = pinProblem(pin) ?? (pin === again ? null : "The two PINs don't match.");
        setError(problem);
        if (!problem) save.mutate();
      }}
    >
      <label>
        {hasPin ? "New PIN" : "PIN"} ({PIN_RULES.minDigits} to {PIN_RULES.maxDigits} digits)
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={pin}
          onChange={(e) => setPin(digits(e.target.value))}
        />
      </label>
      <label>
        Same PIN again
        <input
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(digits(e.target.value))}
        />
      </label>
      {error && <p className="error-box">{error}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={save.isPending}>
          {hasPin ? "Change PIN" : "Set PIN"}
        </button>
      </div>
    </form>
  );
}

/** Which staff this person may set a PIN for already have one. */
export function usePins() {
  return useQuery({
    queryKey: ["pins"],
    queryFn: async () => (await posFetch<{ staffIds: string[] }>("pins", {})).staffIds,
  });
}

/** "My PIN" under the signed-in name: anyone can set or change their own. */
export function MyPinButton() {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const pins = usePins();
  const hasPin = !!pins.data?.includes(me.staff.id);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {hasPin ? "Change my PIN" : "Set my PIN"}
      </button>
      {open && (
        <SlideOver title={hasPin ? "Change my PIN" : "Set my PIN"} onClose={() => setOpen(false)}>
          <p className="muted">
            On a tablet set up for PINs, tap your name and enter this PIN to sign in. Keep it to yourself.
          </p>
          <PinForm hasPin={hasPin} onSaved={() => setOpen(false)} />
        </SlideOver>
      )}
    </>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Settings: set up this tablet for PIN sign-in, and see or remove the tablets already set up. */
export function TabletsSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("Counter tablet");
  const tablets = useQuery({
    queryKey: ["tablets"],
    queryFn: () => posFetch<TabletListItem[]>("tablets", {}),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["tablets"] });
    void qc.invalidateQueries({ queryKey: ["tablet"] });
  };
  const setUp = useMutation({
    mutationFn: () => posFetch("tablet/setup", { name }),
    onSuccess: () => {
      toast("This tablet is set up for PINs");
      refresh();
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const remove = async (id: string) => {
    try {
      await posFetch("tablet/remove", { id });
      toast("Tablet removed");
      refresh();
    } catch (err) {
      toast(errorMessage(err));
    }
  };
  const here = tablets.data?.find((t) => t.thisTablet);

  return (
    <section className="panel">
      <h2>PIN sign-in</h2>
      <p className="muted">
        Set up the counter tablet once, and staff sign in by tapping their name and entering their PIN. PINs
        work only on tablets listed here. Five wrong tries locks that person's PIN for {PIN_RULES.lockMinutes}{" "}
        minutes, and the register locks itself after {PIN_RULES.idleMinutes} minutes with no taps.
      </p>
      {tablets.isError && <p className="error-box">{errorMessage(tablets.error)}</p>}
      {here ? (
        <p>
          <span className="tag ok">This tablet is set up</span> as {here.name}.
        </p>
      ) : (
        <form
          className="actions"
          onSubmit={(e) => {
            e.preventDefault();
            setUp.mutate();
          }}
        >
          <label>
            Tablet name
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" className="primary" disabled={setUp.isPending}>
            Set up this tablet for PINs
          </button>
        </form>
      )}
      {!!tablets.data?.length && (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Tablet</th>
                <th>Set up by</th>
                <th>Last PIN sign-in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tablets.data.map((t) => (
                <tr key={t.id}>
                  <td>
                    <b>{t.name}</b>
                    {t.thisTablet && <span className="sub">This tablet</span>}
                  </td>
                  <td>
                    {t.setUpBy}
                    <span className="sub">{when(t.createdAt)}</span>
                  </td>
                  <td>{t.lastUsedAt ? when(t.lastUsedAt) : "Not yet"}</td>
                  <td>
                    <TwoTapButton
                      label="Remove"
                      confirmLabel="Tap again to remove"
                      onConfirm={() => remove(t.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Lost or replaced a tablet? Remove it here. Whoever is signed in on it is signed out, and its PINs stop
        working.
      </p>
    </section>
  );
}
