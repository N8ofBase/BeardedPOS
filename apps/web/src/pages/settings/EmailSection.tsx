// Settings for bulk email (who it comes from, the footer address) and the store's tags.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { EmailSetup, TagRow } from "@bearded/api";
import { useSession } from "../../session.tsx";
import { errorMessage, fieldErrors } from "../../ui/errors.ts";
import { TwoTapButton } from "../../ui/TwoTapButton.tsx";
import { useToast } from "../../ui/Toast.tsx";

export function EmailSection({ canEdit }: { canEdit: boolean }) {
  const { api } = useSession();
  const setup = useQuery({ queryKey: ["email-setup"], queryFn: () => api.call("getEmailSetup") });
  return (
    <section className="panel">
      <h2>Email</h2>
      <p className="muted">
        Bulk email is sent with Amazon SES from a verified address. Every email shows the store's mailing
        address and an unsubscribe link, as the law requires.
      </p>
      {setup.isError && <p className="error-box">{errorMessage(setup.error)}</p>}
      {setup.data && <EmailForm key={JSON.stringify(setup.data)} s={setup.data} canEdit={canEdit} />}
    </section>
  );
}

function EmailForm({ s, canEdit }: { s: EmailSetup; canEdit: boolean }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({
    fromName: s.fromName,
    fromAddress: s.fromAddress,
    mailingAddress: s.mailingAddress,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.call("saveEmailSetup", v),
    onSuccess: () => {
      toast("Email settings saved");
      setErrors({});
      void qc.invalidateQueries({ queryKey: ["email-setup"] });
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err));
    },
  });
  const field = (k: keyof typeof v, label: string, hint?: string) => (
    <label>
      {label}
      <input
        value={v[k]}
        disabled={!canEdit}
        onChange={(e) => setV({ ...v, [k]: e.target.value })}
        aria-invalid={!!errors[k]}
      />
      {hint && <span className="small muted">{hint}</span>}
      {errors[k] && <span className="field-error">{errors[k]}</span>}
    </label>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      style={{ display: "grid", gap: 14 }}
    >
      <div className="form">
        {field("fromName", "From name", "What people see in their inbox.")}
        {field(
          "fromAddress",
          "From address",
          "On the verified sending domain, like news@mail.bearded.pos.prismcortex.net.",
        )}
        {field("mailingAddress", "Mailing address", "Street, city, state and ZIP for the footer.")}
      </div>
      {canEdit && (
        <div className="actions">
          <button className="primary" type="submit" disabled={save.isPending}>
            Save email settings
          </button>
        </div>
      )}
    </form>
  );
}

export function TagsSection() {
  const { api } = useSession();
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.call("listTags") });
  return (
    <section className="panel">
      <h2>Tags</h2>
      <p className="muted">
        Tags group customers, like VIP or Kickstarter backer, so you can find them and email them. Add tags on
        a customer's form; rename or delete them here.
      </p>
      {tags.data?.length === 0 && <p className="muted">No tags yet.</p>}
      <ul className="plain">
        {tags.data?.map((t) => (
          <TagLine key={`${t.id}-${t.name}`} t={t} />
        ))}
      </ul>
    </section>
  );
}

function TagLine({ t }: { t: TagRow }) {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(t.name);
  const done = (msg: string) => () => {
    toast(msg);
    void qc.invalidateQueries({ queryKey: ["tags"] });
    void qc.invalidateQueries({ queryKey: ["customers"] });
  };
  const rename = useMutation({
    mutationFn: () => api.call("saveTag", { id: t.id, name }),
    onSuccess: done("Tag renamed"),
    onError: (err) => toast(errorMessage(err)),
  });
  const del = useMutation({
    mutationFn: () => api.call("deleteTag", { id: t.id }),
    onSuccess: done("Tag deleted"),
    onError: (err) => toast(errorMessage(err)),
  });
  return (
    <li className="tag-line">
      <input
        aria-label={`Rename ${t.name}`}
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
      />
      <span className="small muted">
        {t.customers} {t.customers === 1 ? "customer" : "customers"}
      </span>
      {name.trim() !== t.name && (
        <button type="button" onClick={() => rename.mutate()} disabled={rename.isPending}>
          Rename
        </button>
      )}
      <TwoTapButton
        label="Delete"
        confirmLabel={`Tap again: take it off ${t.customers}`}
        className="danger"
        onConfirm={() => del.mutate()}
      />
    </li>
  );
}
