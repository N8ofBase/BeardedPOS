// Where the unsubscribe link in every bulk email lands. No sign-in: the token in the
// link says who, and it can only turn email off.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Kysely } from "kysely";
import type { DB } from "@bearded/db";
import { createDemoPublicApi } from "../../api/client.ts";
import { errorMessage } from "../../ui/errors.ts";

export function UnsubscribePage({ db, search }: { db: Kysely<DB>; search: string }) {
  const params = new URLSearchParams(search);
  const businessId = params.get("b") ?? "";
  const token = params.get("t") ?? "";
  const api = useMemo(() => createDemoPublicApi(db, businessId, () => null), [db, businessId]);
  const status = useQuery({
    queryKey: ["unsubscribe", businessId, token],
    queryFn: () => api.call("unsubscribeStatus", { token }),
    enabled: !!businessId && !!token,
    retry: false,
  });
  const off = useMutation({ mutationFn: () => api.call("unsubscribe", { token }) });

  const info = off.data ?? status.data;
  return (
    <div className="center">
      <section className="panel" style={{ maxWidth: 440 }}>
        {!businessId || !token ? (
          <p>That unsubscribe link isn't complete. Reply to the email and we'll take you off the list.</p>
        ) : status.isPending ? (
          <p className="muted">Loading…</p>
        ) : status.isError ? (
          <p className="error-box">{errorMessage(status.error)}</p>
        ) : info!.alreadyOff ? (
          <>
            <h1>You're unsubscribed</h1>
            <p>
              {info!.email} won't get any more news emails from {info!.storeName}. Receipts for things you buy
              still come by email if you ask for them.
            </p>
          </>
        ) : (
          <>
            <h1>Unsubscribe?</h1>
            <p>
              Stop news emails from {info!.storeName} to {info!.email}?
            </p>
            {off.isError && <p className="error-box">{errorMessage(off.error)}</p>}
            <button type="button" className="primary" onClick={() => off.mutate()} disabled={off.isPending}>
              Unsubscribe
            </button>
          </>
        )}
      </section>
    </div>
  );
}
