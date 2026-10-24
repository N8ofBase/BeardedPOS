// Bulk email: the list of emails, the composer (who it's for by type and tag, the live
// count, a preview and a test), and what happened after sending.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router";
import {
  can,
  EVERYONE,
  validateCampaign,
  type CustomerKind,
  type EmailAudience,
  type RenderedEmail,
} from "@pet-pos/core";
import type { CampaignDetail, CampaignRow } from "@pet-pos/api";
import { useSession } from "../../session.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { TwoTapButton } from "../../ui/TwoTapButton.tsx";
import { useToast } from "../../ui/Toast.tsx";

export function EmailRoutes() {
  return (
    <Routes>
      <Route index element={<EmailList />} />
      <Route path="new" element={<Composer key="new" campaign={null} />} />
      <Route path=":id" element={<CampaignPage />} />
    </Routes>
  );
}

const STATUS: Record<CampaignRow["status"], string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
};

function EmailList() {
  const { api } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Stands in for the hosted scheduler: send anything whose time has come.
  useEffect(() => {
    void api.call("releaseDueCampaigns").then(({ released }) => {
      if (released) void qc.invalidateQueries({ queryKey: ["campaigns"] });
    });
  }, [api, qc]);
  const list = useQuery({ queryKey: ["campaigns"], queryFn: () => api.call("listCampaigns") });
  const setup = useQuery({ queryKey: ["email-setup"], queryFn: () => api.call("getEmailSetup") });

  return (
    <>
      <div className="page-head">
        <h1>Email</h1>
        <div className="actions">
          <button type="button" className="primary" onClick={() => navigate("new")}>
            New email
          </button>
        </div>
      </div>
      {setup.data && setup.data.missing.length > 0 && (
        <p className="note">
          Before sending, add {setup.data.missing.join(" and ")} in <Link to="/settings">Settings</Link>.
        </p>
      )}
      <p className="muted">
        Send news to customers by type and tag. Only people who agreed to email get it, and every email has an
        unsubscribe link. In this demo nothing is really sent: each email is kept as a preview.
      </p>
      {list.isError && <p className="error-box">{errorMessage(list.error)}</p>}
      {list.data?.length === 0 && <p className="muted">No emails yet.</p>}
      {!!list.data?.length && (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>To</th>
                <th>Status</th>
                <th className="num">Sent</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={c.id}>{c.subject}</Link>
                  </td>
                  <td className="small">{c.description}</td>
                  <td>
                    <span className={c.status === "sent" ? "tag ok" : "tag muted"}>{STATUS[c.status]}</span>{" "}
                    <span className="small muted">{when(c)}</span>
                  </td>
                  <td className="num">{c.counts.sent || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function when(c: Pick<CampaignRow, "status" | "sendAt" | "sentAt" | "createdAt">) {
  const d = c.status === "sent" ? c.sentAt : c.status === "scheduled" ? c.sendAt : c.createdAt;
  return d ? d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
}

function CampaignPage() {
  const { id = "" } = useParams();
  const { api } = useSession();
  const c = useQuery({ queryKey: ["campaign", id], queryFn: () => api.call("getCampaign", { id }) });
  if (c.isPending) return <p className="muted">Loading…</p>;
  if (c.isError)
    return (
      <>
        <p className="error-box">{errorMessage(c.error)}</p>
        <Link to="..">Back to email</Link>
      </>
    );
  if (c.data.status === "draft" || c.data.status === "scheduled")
    return <Composer key={id} campaign={c.data} />;
  return <SentCampaign c={c.data} />;
}

function SentCampaign({ c }: { c: CampaignDetail }) {
  const { api } = useSession();
  const emails = useQuery({
    queryKey: ["campaign-emails", c.id],
    queryFn: () => api.call("campaignEmails", { id: c.id }),
  });
  const preview = useQuery({
    queryKey: ["campaign-preview", c.id],
    queryFn: () =>
      api.call("previewCampaignEmail", { id: c.id, subject: c.subject, body: c.body, audience: c.audience }),
  });
  const n = c.counts;
  return (
    <>
      <div className="page-head">
        <div>
          <Link to=".." className="small">
            ← Email
          </Link>
          <h1>{c.subject}</h1>
          <p className="muted small">
            {STATUS[c.status]} {when(c)} · {c.description}
          </p>
        </div>
      </div>
      <div className="kpis">
        <Kpi label="Sent" value={n.sent} />
        <Kpi label="Delivered" value={n.delivered} />
        <Kpi label="Bounced" value={n.bounced} />
        <Kpi label="Marked as spam" value={n.complained} />
        <Kpi label="Unsubscribed" value={n.unsubscribed} />
        <Kpi label="Not sent" value={n.failed + n.queued} />
      </div>
      {preview.data && <EmailPreview email={preview.data} />}
      <section className="panel">
        <h2>Who got it</h2>
        <div className="tablewrap">
          <table>
            <tbody>
              {emails.data?.map((e) => (
                <tr key={e.customerId}>
                  <td>
                    <Link to={`/customers/${e.customerId}`}>{e.name}</Link>
                  </td>
                  <td className="small">{e.toAddress}</td>
                  <td>
                    <span
                      className={
                        e.status === "failed" || e.status === "bounced" || e.status === "complained"
                          ? "tag low"
                          : "tag ok"
                      }
                    >
                      {e.status === "preview" ? "Preview" : e.status[0]!.toUpperCase() + e.status.slice(1)}
                    </span>{" "}
                    {e.error && <span className="small muted">{e.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="kpi">
      <span className="muted small">{label}</span>
      <b className="num">{value}</b>
    </div>
  );
}

export function EmailPreview({ email }: { email: RenderedEmail }) {
  return (
    <section className="panel">
      <h2>Preview</h2>
      <p className="small muted">
        From {email.from} · To {email.to} · Subject <b>{email.subject}</b>
      </p>
      <iframe className="email-preview" title="Email preview" sandbox="" srcDoc={email.html} />
    </section>
  );
}

function Composer({ campaign }: { campaign: CampaignDetail | null }) {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [subject, setSubject] = useState(campaign?.subject ?? "");
  const [body, setBody] = useState(campaign?.body ?? "Hi {first name},\n\n");
  const [audience, setAudience] = useState<EmailAudience>(campaign?.audience ?? EVERYONE);
  const [later, setLater] = useState(false);
  const [sendAt, setSendAt] = useState(campaign?.sendAt ? toLocalInput(campaign.sendAt) : "");
  const [testTo, setTestTo] = useState("");
  const [preview, setPreview] = useState<RenderedEmail | null>(null);
  const [errors, setErrors] = useState<{ subject?: string; body?: string }>({});

  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.call("listTags") });
  const count = useQuery({
    queryKey: ["audience", audience],
    queryFn: () => api.call("previewAudience", { audience }),
    placeholderData: (prev) => prev,
  });
  const input = { id: campaign?.id, subject, body, audience };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["campaigns"] });
    void qc.invalidateQueries({ queryKey: ["campaign"] });
  };

  const check = () => {
    const e = validateCampaign({ subject, body });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = useMutation({
    mutationFn: () => api.call("saveCampaign", input),
    onSuccess: ({ id }) => {
      toast("Draft saved");
      refresh();
      if (!campaign) navigate(`../${id}`, { replace: true });
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const send = useMutation({
    mutationFn: () =>
      api.call("sendCampaign", { ...input, sendAt: later && sendAt ? new Date(sendAt).toISOString() : null }),
    onSuccess: (r) => {
      toast(r.scheduled ? "Email scheduled" : `Sent to ${r.sent} ${r.sent === 1 ? "customer" : "customers"}`);
      refresh();
      void qc.invalidateQueries({ queryKey: ["timeline"] });
      navigate(campaign ? "." : `../${r.id}`, { replace: true });
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const del = useMutation({
    mutationFn: () => api.call("deleteCampaign", { id: campaign!.id }),
    onSuccess: () => {
      toast("Email deleted");
      refresh();
      navigate("..");
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const test = useMutation({
    mutationFn: () => api.call("sendTestEmail", { subject, body, to: testTo }),
    onSuccess: (e) => {
      setPreview(e);
      toast(`Test made for ${e.to}. In the demo it shows below instead of being sent.`);
    },
    onError: (err) => toast(errorMessage(err)),
  });
  const showPreview = useMutation({
    mutationFn: () => api.call("previewCampaignEmail", input),
    onSuccess: setPreview,
    onError: (err) => toast(errorMessage(err)),
  });

  const toggleKind = (k: CustomerKind) =>
    setAudience({
      ...audience,
      kinds: audience.kinds.includes(k) ? audience.kinds.filter((x) => x !== k) : [...audience.kinds, k],
    });
  const tagList = (key: "anyTags" | "allTags" | "notTags", label: string, hint: string) => (
    <fieldset className="tag-rule">
      <legend>{label}</legend>
      <span className="small muted">{hint}</span>
      <span className="chips">
        {tags.data?.map((t) => {
          const on = audience[key].includes(t.id);
          const usedElsewhere =
            key === "notTags"
              ? audience.anyTags.includes(t.id) || audience.allTags.includes(t.id)
              : audience.notTags.includes(t.id);
          return (
            <label key={t.id} className={`chip-toggle${on ? " on" : ""}`}>
              <input
                type="checkbox"
                checked={on}
                disabled={usedElsewhere}
                onChange={() =>
                  setAudience({
                    ...audience,
                    [key]: on ? audience[key].filter((x) => x !== t.id) : [...audience[key], t.id],
                  })
                }
              />
              {t.name}
            </label>
          );
        })}
      </span>
    </fieldset>
  );

  const n = count.data;
  const busy = save.isPending || send.isPending;
  return (
    <>
      <div className="page-head">
        <div>
          <Link to=".." className="small">
            ← Email
          </Link>
          <h1>
            {campaign ? (campaign.status === "scheduled" ? "Scheduled email" : "Draft email") : "New email"}
          </h1>
        </div>
        <div className="actions">
          {campaign && (
            <TwoTapButton
              label="Delete"
              confirmLabel="Tap again to delete"
              className="danger"
              onConfirm={() => del.mutate()}
            />
          )}
        </div>
      </div>

      <section className="panel">
        <h2>Who gets it</h2>
        <div className="chips">
          <label className="check">
            <input
              type="checkbox"
              checked={audience.kinds.includes("person")}
              onChange={() => toggleKind("person")}
            />{" "}
            People
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={audience.kinds.includes("retailer")}
              onChange={() => toggleKind("retailer")}
            />{" "}
            Retailers
          </label>
          <span className="small muted">Tick neither for both.</span>
        </div>
        {tags.data?.length === 0 && (
          <p className="muted small">No tags yet. Add tags to customers to send to a group.</p>
        )}
        {!!tags.data?.length && (
          <>
            {tagList("anyTags", "Tagged with any of", "Leave empty for no tag needed.")}
            {tagList("allTags", "And tagged with all of", "Optional.")}
            {tagList("notTags", "Leave out anyone tagged", "Optional.")}
          </>
        )}
        {n && (
          <p className="audience-count" role="status">
            <b>
              {n.count} {n.count === 1 ? "customer" : "customers"}
            </b>{" "}
            will get this. <span className="muted">{n.description}.</span>
            {n.sample.length > 0 && <span className="small muted"> For example: {n.sample.join(", ")}.</span>}
            {(n.notOptedIn > 0 || n.noEmail > 0 || n.suppressed > 0) && (
              <span className="small muted">
                {" "}
                Left out:{" "}
                {[
                  n.notOptedIn && `${n.notOptedIn} haven't agreed to email`,
                  n.noEmail && `${n.noEmail} have no email address`,
                  n.suppressed && `${n.suppressed} unsubscribed or bounced`,
                ]
                  .filter(Boolean)
                  .join(", ")}
                .
              </span>
            )}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>The email</h2>
        <div className="form" style={{ gridTemplateColumns: "1fr" }}>
          <label>
            Subject
            <input
              value={subject}
              maxLength={150}
              onChange={(e) => setSubject(e.target.value)}
              aria-invalid={!!errors.subject}
            />
            {errors.subject && <span className="field-error">{errors.subject}</span>}
          </label>
          <label>
            Message
            <textarea
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-invalid={!!errors.body}
            />
            <span className="small muted">
              Plain text. A blank line starts a new paragraph, web addresses become links, and{" "}
              {"{first name}"} becomes each customer's first name. The unsubscribe link and the store's
              mailing address are added at the bottom.
            </span>
            {errors.body && <span className="field-error">{errors.body}</span>}
          </label>
        </div>
        <div className="actions">
          <button
            type="button"
            onClick={() => check() && showPreview.mutate()}
            disabled={showPreview.isPending}
          >
            Preview
          </button>
          <input
            type="email"
            aria-label="Send a test to"
            placeholder="you@example.com"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            style={{ width: 220 }}
          />
          <button type="button" onClick={() => check() && test.mutate()} disabled={test.isPending}>
            Send me a test
          </button>
        </div>
      </section>

      {preview && <EmailPreview email={preview} />}

      <section className="panel">
        <h2>Send</h2>
        <label className="check">
          <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} /> Send later
        </label>
        {later && (
          <label style={{ maxWidth: 260 }}>
            Date and time
            <input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
          </label>
        )}
        <div className="actions">
          <button type="button" onClick={() => check() && save.mutate()} disabled={busy}>
            Save draft
          </button>
          {can(me.staff.role, "email.send") && (
            <TwoTapButton
              className="primary"
              disabled={busy || !n?.count || (later && !sendAt)}
              label={later ? "Schedule" : `Send to ${n?.count ?? 0}`}
              confirmLabel={later ? "Tap again to schedule" : `Tap again to send to ${n?.count ?? 0}`}
              onConfirm={() => {
                if (check()) send.mutate();
              }}
            />
          )}
        </div>
      </section>
    </>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
