import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { formatPhone, validateCustomer, type CustomerInput } from "@pet-pos/core";
import type { CustomerProfile } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage, fieldErrors } from "../../ui/errors.ts";
import { SlideOver } from "../../ui/SlideOver.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { TagPicker } from "./crm.tsx";

const EMPTY: CustomerInput = {
  name: "",
  phone: "",
  email: "",
  street: "",
  city: "",
  state: "",
  zip: "",
  birthday: "",
  smsOptIn: false,
  notes: "",
  kind: "person",
  company: "",
  wholesaleTerms: "",
  emailOptIn: false,
};

/** Add or edit a customer in one form, as in the prototype. */
export function CustomerForm({
  id,
  onClose,
  onSaved,
}: {
  id: string | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { api } = useSession();
  const existing = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api.call("getCustomer", { id: id! }),
    enabled: !!id,
  });

  if (id && !existing.data)
    return (
      <SlideOver title="Edit customer" onClose={onClose}>
        {existing.isError ? (
          <p className="error-box">{errorMessage(existing.error)}</p>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </SlideOver>
    );
  return <Form key={id ?? "new"} profile={existing.data ?? null} onClose={onClose} onSaved={onSaved} />;
}

function toInput(p: CustomerProfile): CustomerInput {
  return {
    name: p.name,
    phone: formatPhone(p.phone),
    email: p.email ?? "",
    street: p.street ?? "",
    city: p.city ?? "",
    state: p.state ?? "",
    zip: p.zip ?? "",
    birthday: p.birthday ?? "",
    smsOptIn: p.smsOptIn,
    notes: p.notes ?? "",
    kind: p.kind,
    company: p.company ?? "",
    wholesaleTerms: p.wholesaleTerms ?? "",
    emailOptIn: p.emailOptIn,
  };
}

function Form({
  profile,
  onClose,
  onSaved,
}: {
  profile: CustomerProfile | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [c, setC] = useState<CustomerInput>(profile ? toInput(profile) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<string[]>(profile?.tags.map((t) => t.name) ?? []);

  const save = useMutation({
    mutationFn: async () => {
      const r = await api.call("saveCustomer", { id: profile?.id, customer: c });
      await api.call("setCustomerTags", { customerId: r.id, tags });
      return r;
    },
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: ["tags"] });
      toast(profile ? "Customer saved" : "Customer added");
      void qc.invalidateQueries({ queryKey: ["customers"] });
      void qc.invalidateQueries({ queryKey: ["customer", id] });
      onSaved?.(id);
      onClose();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = { ...validateCustomer(c) };
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate();
  }

  const set = (k: keyof CustomerInput) => (e: { target: { value: string } }) =>
    setC({ ...c, [k]: e.target.value });
  const field = (
    k: keyof CustomerInput,
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <label>
      {label}
      <input
        value={c[k] as string}
        onChange={set(k)}
        autoComplete="off"
        aria-invalid={!!errors[k]}
        aria-describedby={errors[k] ? `err-${k}` : undefined}
        {...props}
      />
      {errors[k] && (
        <span className="field-error" id={`err-${k}`}>
          {errors[k]}
        </span>
      )}
    </label>
  );

  return (
    <SlideOver title={profile ? `Edit ${profile.name}` : "New customer"} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <fieldset className="kind-pick">
          <legend>Type</legend>
          {(["person", "retailer"] as const).map((k) => (
            <label key={k} className="check">
              <input
                type="radio"
                name="kind"
                checked={c.kind === k}
                onChange={() => setC({ ...c, kind: k })}
              />
              {k === "person" ? "Person" : "Retailer (a store that buys wholesale)"}
            </label>
          ))}
        </fieldset>
        <div className="form">
          {c.kind === "retailer" && field("company", "Store name", { required: true })}
          {field("name", c.kind === "retailer" ? "Contact person" : "Name", {
            required: true,
            autoFocus: !profile,
          })}
          {field("phone", "Phone", { inputMode: "tel" })}
          {field("email", "Email", { type: "email" })}
          {field("street", "Street address")}
          {field("city", "City")}
          {field("state", "State", { maxLength: 2, style: { textTransform: "uppercase" } })}
          {field("zip", "ZIP", { inputMode: "numeric", maxLength: 10 })}
          {field("birthday", "Birthday (optional)", { type: "date" })}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={c.smsOptIn}
            onChange={(e) => setC({ ...c, smsOptIn: e.target.checked })}
          />
          Text messages OK (order and pickup alerts)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={!!c.emailOptIn}
            onChange={(e) => setC({ ...c, emailOptIn: e.target.checked })}
          />
          Email OK (news, new games and VIP offers)
        </label>
        {c.kind === "retailer" && (
          <label>
            Wholesale terms
            <textarea
              rows={2}
              maxLength={500}
              placeholder="50% off MSRP, 6-unit minimum, net 30"
              value={c.wholesaleTerms}
              onChange={set("wholesaleTerms")}
            />
            {errors.wholesaleTerms && <span className="field-error">{errors.wholesaleTerms}</span>}
          </label>
        )}
        <div>
          <span className="label">Tags</span>
          <TagPicker value={tags} onChange={setTags} />
        </div>
        <label>
          Notes
          <textarea rows={2} value={c.notes} onChange={set("notes")} />
        </label>

        <div className="actions">
          <button className="primary" type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : profile ? "Save customer" : "Add customer"}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </SlideOver>
  );
}
