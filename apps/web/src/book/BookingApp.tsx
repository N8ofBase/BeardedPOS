import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { Kysely } from "kysely";
import { clockText, formatMoney, formatPhone, readableOn, shortDay } from "@pet-pos/core";
import type { MyAppointment } from "@pet-pos/api";
import { demoBusinessId, type DB } from "@pet-pos/db";
import { createDemoPublicApi } from "../api/client.ts";
import { errorMessage } from "../ui/errors.ts";
import { StoreMark } from "../ui/StoreMark.tsx";
import { TwoTapButton } from "../ui/TwoTapButton.tsx";
import { BookFlow, type BookStart } from "./BookFlow.tsx";
import { BookingContext, loadCustomer, saveCustomer, useBooking } from "./context.ts";
import { SignIn } from "./SignIn.tsx";

/** The public booking page at /book: the customer's view of the store. */
export function BookingApp({ db }: { db: Kysely<DB> }) {
  const business = useQuery({ queryKey: ["demoBusiness"], queryFn: () => demoBusinessId(db) });
  if (business.isPending) return <Center>Opening the booking page…</Center>;
  if (!business.data) return <Center>This store isn't set up yet.</Center>;
  return <WithStore db={db} businessId={business.data} />;
}

function WithStore({ db, businessId }: { db: Kysely<DB>; businessId: string }) {
  const [customer, setCustomer] = useState(loadCustomer);
  const qc = useQueryClient();
  const api = useMemo(
    () => createDemoPublicApi(db, businessId, () => loadCustomer()?.token ?? null),
    [db, businessId],
  );
  const page = useQuery({ queryKey: ["bookingPage"], queryFn: () => api.call("bookingPage") });

  if (page.isPending) return <Center>Opening the booking page…</Center>;
  if (page.isError) return <Center>{errorMessage(page.error)}</Center>;
  const p = page.data;
  const brand = p.brandColor ?? "#0f6e5a";

  const session = {
    api,
    page: p,
    name: customer?.name ?? null,
    signIn: (token: string, name: string) => {
      saveCustomer({ token, name });
      setCustomer({ token, name });
    },
    signOut: () => {
      const t = customer?.token;
      saveCustomer(null);
      setCustomer(null);
      qc.removeQueries({ queryKey: ["myAccount"] });
      if (t) void api.call("signOut", { token: t });
    },
  };

  return (
    <BookingContext.Provider value={session}>
      <div className="book">
        <div className="demo-banner" role="note">
          <span>Demo · this is what customers see</span>
          <a href="/grooming">Back to the staff app</a>
        </div>
        <header className="book-head" style={{ background: brand, color: readableOn(brand) }}>
          <StoreMark name={p.storeName} logo={p.logo} color={readableOn(brand)} />
          <span>
            <b>{p.storeName}</b>
            <small>Book a groom online</small>
          </span>
          {customer && (
            <button
              type="button"
              className="link"
              style={{ color: "inherit", marginLeft: "auto" }}
              onClick={session.signOut}
            >
              Sign out
            </button>
          )}
        </header>
        <main className="book-main">
          {!p.enabled ? (
            <p className="panel">
              Online booking isn't available right now.{" "}
              {p.phone ? `Please call us at ${formatPhone(p.phone)}.` : "Please call the store."}
            </p>
          ) : (
            <>
              {p.message && <p className="muted">{p.message}</p>}
              {customer ? <Account /> : <SignIn />}
              {p.phone && <p className="muted small">Questions? Call us at {formatPhone(p.phone)}.</p>}
            </>
          )}
        </main>
      </div>
    </BookingContext.Provider>
  );
}

type Tab = "book" | "mine" | "pets";

function Account() {
  const { api, name, signOut } = useBooking();
  const [tab, setTab] = useState<Tab>("book");
  const [start, setStart] = useState<BookStart | undefined>();
  const [moving, setMoving] = useState<MyAppointment | null>(null);
  const [booked, setBooked] = useState<MyAppointment | null>(null);
  const acct = useQuery({ queryKey: ["myAccount"], queryFn: () => api.call("myAccount") });

  if (acct.isError) {
    // A session that's expired or signed out elsewhere.
    return (
      <div className="panel">
        <p>{errorMessage(acct.error)}</p>
        <button type="button" onClick={signOut}>
          Sign in again
        </button>
      </div>
    );
  }
  if (!acct.data) return <p className="muted">Loading your account…</p>;
  const a = acct.data;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p style={{ margin: 0 }}>
        Hi, <b>{name}</b>.
      </p>
      <div className="seg" role="group" aria-label="Your account">
        <button
          type="button"
          aria-pressed={tab === "book"}
          onClick={() => {
            setTab("book");
            setBooked(null);
            setMoving(null);
          }}
        >
          Book
        </button>
        <button type="button" aria-pressed={tab === "mine"} onClick={() => setTab("mine")}>
          My appointments{a.upcoming.length ? ` (${a.upcoming.length})` : ""}
        </button>
        <button type="button" aria-pressed={tab === "pets"} onClick={() => setTab("pets")}>
          My pets
        </button>
      </div>

      {tab === "book" && booked && (
        <section className="panel" role="status" style={{ display: "grid", gap: 6 }}>
          <h2 style={{ margin: 0 }}>You're booked!</h2>
          <p style={{ margin: 0 }}>
            <b>{booked.petName}</b> · {booked.label}
            <br />
            {shortDay(booked.day)} at {clockText(booked.start)} with {booked.groomerName} ·{" "}
            {formatMoney(booked.priceCents)}
          </p>
          <div className="actions">
            <button type="button" onClick={() => setTab("mine")}>
              See my appointments
            </button>
            <button
              type="button"
              onClick={() => {
                setBooked(null);
                setStart(undefined);
              }}
            >
              Book another
            </button>
          </div>
        </section>
      )}
      {tab === "book" && !booked && (
        <BookFlow key={JSON.stringify(start ?? {})} pets={a.pets} start={start} onDone={setBooked} />
      )}

      {tab === "mine" && moving && (
        <BookFlow
          pets={a.pets}
          reschedule={moving}
          onCancel={() => setMoving(null)}
          onDone={(x) => {
            setMoving(null);
            setBooked(null);
            void x;
          }}
        />
      )}
      {tab === "mine" && !moving && (
        <MyAppointments
          upcoming={a.upcoming}
          recent={a.recent}
          onMove={setMoving}
          onAgain={(x) => {
            setStart({ petId: x.petId ?? undefined, serviceId: x.serviceId, addonIds: x.addonIds });
            setBooked(null);
            setTab("book");
          }}
        />
      )}
      {tab === "pets" && <MyPets />}
    </div>
  );
}

function MyAppointments({
  upcoming,
  recent,
  onMove,
  onAgain,
}: {
  upcoming: MyAppointment[];
  recent: MyAppointment[];
  onMove: (a: MyAppointment) => void;
  onAgain: (a: MyAppointment) => void;
}) {
  const { api, page } = useBooking();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: (id: string) => api.call("cancelMine", { id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["myAccount"] }),
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {error && <p className="error-box">{error}</p>}
      {upcoming.length === 0 && <p className="muted">No upcoming appointments.</p>}
      {upcoming.map((a) => (
        <article key={a.id} className="mycard" aria-label={`${a.petName} on ${shortDay(a.day)}`}>
          <span className="when">
            {shortDay(a.day)} · {clockText(a.start)}
          </span>
          <span>
            <b>{a.petName}</b> · {a.label} · {a.groomerName} · {formatMoney(a.priceCents)}
          </span>
          {a.canChange ? (
            <div className="actions">
              <button type="button" onClick={() => onMove(a)}>
                Reschedule
              </button>
              <TwoTapButton
                className="dangerbtn"
                label="Cancel"
                confirmLabel="Tap again to cancel"
                onConfirm={() => cancel.mutate(a.id)}
              />
            </div>
          ) : (
            <span className="muted small">
              {a.status === "checked_in"
                ? "Checked in."
                : `It's less than ${page.cutoffHours} hours away. Please call us${page.phone ? ` at ${formatPhone(page.phone)}` : ""} to change it.`}
            </span>
          )}
        </article>
      ))}
      {recent.length > 0 && (
        <>
          <h3 style={{ margin: "8px 0 0" }}>Past grooms</h3>
          {recent.map((a) => (
            <div
              key={a.id}
              className="actions"
              style={{ alignItems: "center", justifyContent: "space-between" }}
            >
              <span>
                {shortDay(a.day)} · {a.petName} · {a.label}
              </span>
              <button type="button" onClick={() => onAgain(a)}>
                Book again
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function MyPets() {
  const { api } = useBooking();
  const acct = useQuery({ queryKey: ["myAccount"], queryFn: () => api.call("myAccount") });
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {acct.data?.pets.map((p) => (
        <div key={p.id} className="mycard">
          <span>
            <b>{p.name}</b> · {p.breed ?? p.species} · {p.size ? `size ${p.size}` : "size not set"}
          </span>
          {p.rabiesLapsed && <span className="tag out">Rabies expired: please bring proof or call us.</span>}
        </div>
      ))}
      {acct.data?.pets.length === 0 && <p className="muted">No pets yet. Add one when you book.</p>}
      <p className="muted small">
        To add a pet, start a booking and tap “+ Add a pet”. For other changes, call the store.
      </p>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="center">
      <p className="muted" role="status">
        {children}
      </p>
    </div>
  );
}
