import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  addressLine,
  can,
  formatDate,
  formatPhone,
  rabiesLapsed,
  SIZES,
  SPECIES_LABEL,
  vaccineStatus,
  VACCINES,
  type PetSize,
} from "@pet-pos/core";
import type { PetDetail } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";
import { BirthdayTag, PetChip, Punches } from "./bits.tsx";
import { CustomerForm } from "./CustomerForm.tsx";
import { DeleteCustomer } from "./DeleteCustomer.tsx";
import { OrderHistory } from "./OrderHistory.tsx";

export function CustomerProfilePage() {
  const { id = "" } = useParams();
  const { api, me } = useSession();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const profile = useQuery({ queryKey: ["customer", id], queryFn: () => api.call("getCustomer", { id }) });
  const canEdit = can(me.staff.role, "customers.edit");
  const canDelete = can(me.staff.role, "customers.delete");

  if (profile.isPending) return <p className="muted">Loading…</p>;
  if (profile.isError)
    return (
      <>
        <p className="error-box">{errorMessage(profile.error)}</p>
        <Link to="..">Back to customers</Link>
      </>
    );
  const c = profile.data;
  const address = addressLine(c);

  return (
    <>
      <div className="page-head">
        <div>
          <Link to=".." className="small">
            ← Customers
          </Link>
          <h1>{c.name}</h1>
        </div>
        <div className="actions">
          {canEdit && (
            <button type="button" className="primary" onClick={() => setEditing(true)}>
              Edit customer
            </button>
          )}
          {canDelete && (
            <button type="button" className="danger" onClick={() => setDeleting(true)}>
              Delete
            </button>
          )}
        </div>
      </div>

      {deleting && (
        <DeleteCustomer
          id={c.id}
          onDone={(deleted) => (deleted ? navigate("..", { relative: "path" }) : setDeleting(false))}
        />
      )}

      <section className="panel">
        <h2>Contact</h2>
        {c.phone && <p className="mono">{formatPhone(c.phone)}</p>}
        {c.email && <p>{c.email}</p>}
        {address && <p className="muted">{address}</p>}
        {c.birthday && (
          <p className="muted">
            Birthday {formatDate(c.birthday)} <BirthdayTag birthday={c.birthday} />
          </p>
        )}
        <p className="muted small">{c.smsOptIn ? "Text messages OK" : "No text messages"}</p>
        {c.notes && <p>{c.notes}</p>}
      </section>

      {c.punchCards.length > 0 && (
        <section className="panel">
          <h2>Astro punch cards</h2>
          {c.punchCards.map((card) => (
            <Punches key={card.programId} card={card} />
          ))}
        </section>
      )}

      {c.pets.map((p) => (
        <PetPanel key={p.id} pet={p} customerId={c.id} canEdit={canEdit} />
      ))}
      {c.pets.length === 0 && <p className="muted">No pets yet. Edit the customer to add one.</p>}

      <OrderHistory customerId={c.id} />

      <p className="muted small">Appointments show here once the grooming calendar is built.</p>

      {editing && <CustomerForm id={c.id} onClose={() => setEditing(false)} />}
    </>
  );
}

function PetPanel({ pet, customerId, canEdit }: { pet: PetDetail; customerId: string; canEdit: boolean }) {
  const lapsed = rabiesLapsed(pet.vaccinations);
  const rabies = pet.vaccinations.find((v) => v.vaccine.toLowerCase() === "rabies");
  return (
    <section className="panel">
      <h2>{pet.name}</h2>
      <div>
        <PetChip pet={pet} />
      </div>
      {lapsed && rabies && (
        <p className="warn-line">
          Rabies expired {formatDate(rabies.expiresOn)}; booking will be blocked until it's updated.
        </p>
      )}
      <PetDetails pet={pet} customerId={customerId} canEdit={canEdit} />
      <Vaccinations pet={pet} customerId={customerId} canEdit={canEdit} />
    </section>
  );
}

function PetDetails({ pet, customerId, canEdit }: { pet: PetDetail; customerId: string; canEdit: boolean }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    size: pet.size ?? "",
    coat: pet.coat ?? "",
    weight: pet.weightLb === null ? "" : String(pet.weightLb),
    temperament: pet.temperament ?? "",
    allergies: pet.allergies ?? "",
    vetName: pet.vetName ?? "",
  });
  const save = useMutation({
    mutationFn: () =>
      api.call("savePetDetails", {
        petId: pet.id,
        size: (f.size || null) as PetSize | null,
        coat: f.coat,
        weightLb: f.weight.trim() ? Number(f.weight) : null,
        temperament: f.temperament,
        allergies: f.allergies,
        vetName: f.vetName,
      }),
    onSuccess: () => {
      toast(`${pet.name}'s details saved`);
      void qc.invalidateQueries({ queryKey: ["customer", customerId] });
    },
    onError: (err) => toast(errorMessage(err)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (f.weight.trim() && !(Number(f.weight) > 0))
      return toast("Weight must be a number of pounds, like 24.5.");
    save.mutate();
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
      <fieldset disabled={!canEdit} className="form" style={{ border: 0, padding: 0, margin: 0 }}>
        <label>
          Size
          <select value={f.size} onChange={set("size")}>
            <option value="">Not set</option>
            {SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Weight (lb)
          <input value={f.weight} onChange={set("weight")} inputMode="decimal" />
        </label>
        <label>
          Coat
          <input value={f.coat} onChange={set("coat")} placeholder="e.g. Double coat, matted" />
        </label>
        <label>
          Temperament
          <input value={f.temperament} onChange={set("temperament")} />
        </label>
        <label>
          Allergies
          <input value={f.allergies} onChange={set("allergies")} />
        </label>
        <label>
          Vet
          <input value={f.vetName} onChange={set("vetName")} />
        </label>
      </fieldset>
      {canEdit && (
        <div>
          <button disabled={save.isPending}>Save {SPECIES_LABEL[pet.species].toLowerCase()} details</button>
        </div>
      )}
    </form>
  );
}

const STATUS_TAG = { expired: ["out", "Expired"], due: ["low", "Due soon"], ok: ["ok", "Current"] } as const;

function Vaccinations({
  pet,
  customerId,
  canEdit,
}: {
  pet: PetDetail;
  customerId: string;
  canEdit: boolean;
}) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState(
    pet.vaccinations.map((v) => ({ vaccine: v.vaccine, expiresOn: v.expiresOn })),
  );

  const save = useMutation({
    mutationFn: () => api.call("saveVaccinations", { petId: pet.id, rows }),
    onSuccess: () => {
      toast("Vaccinations saved");
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["customer", customerId] });
    },
    onError: (err) => toast(errorMessage(err)),
  });

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <h3>Vaccinations</h3>
      {!editing && (
        <>
          {pet.vaccinations.length === 0 && <p className="muted small">No vaccination records.</p>}
          {pet.vaccinations.map((v) => {
            const [cls, label] = STATUS_TAG[vaccineStatus(v.expiresOn)];
            return (
              <p key={v.id} className="small">
                <b>{v.vaccine}</b> · expires {formatDate(v.expiresOn)}{" "}
                <span className={`tag ${cls}`}>{label}</span>
              </p>
            );
          })}
          {canEdit && (
            <div>
              <button type="button" onClick={() => setEditing(true)}>
                Edit vaccinations
              </button>
            </div>
          )}
        </>
      )}
      {editing && (
        <form
          style={{ display: "grid", gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <datalist id="vaccines">
            {VACCINES.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          {rows.map((r, i) => (
            <div className="vacc-row" key={i}>
              <label>
                Vaccine
                <input
                  list="vaccines"
                  value={r.vaccine}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, vaccine: e.target.value } : x)))
                  }
                />
              </label>
              <label>
                Expires
                <input
                  type="date"
                  value={r.expiresOn}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, expiresOn: e.target.value } : x)))
                  }
                />
              </label>
              <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <div className="actions">
            <button
              type="button"
              onClick={() => setRows([...rows, { vaccine: rows.length ? "" : "Rabies", expiresOn: "" }])}
            >
              + Add vaccine
            </button>
            <button className="primary" disabled={save.isPending}>
              Save vaccinations
            </button>
            <button
              type="button"
              onClick={() => {
                setRows(pet.vaccinations.map((v) => ({ vaccine: v.vaccine, expiresOn: v.expiresOn })));
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
