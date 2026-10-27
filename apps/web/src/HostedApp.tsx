import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { Me } from "@bearded/api";
import { createHttpApi, posFetch, SignedOutError } from "./api/http.ts";
import { EmailSignIn } from "./auth/EmailSignIn.tsx";
import { AdminShell } from "./layout/AdminShell.tsx";
import { SessionContext } from "./session.tsx";

/** The register on the store's server: staff sign in with an email code, and every call goes over HTTPS. */
export function HostedApp() {
  const queryClient = useQueryClient();
  // Bumped on every sign-in and sign-out, so nothing from the last person's session is shown.
  const [epoch, setEpoch] = useState(0);

  const api = useMemo(
    () =>
      createHttpApi(() => {
        queryClient.clear();
        setEpoch((n) => n + 1);
      }),
    [queryClient],
  );

  const me = useQuery({
    queryKey: ["me", "hosted", epoch],
    queryFn: async () => {
      // Straight to the server, not through api: a signed-out answer here just shows sign-in.
      try {
        return (await posFetch<{ output: Me }>("call/me", {})).output;
      } catch (e) {
        if (e instanceof SignedOutError) return null;
        throw e;
      }
    },
  });

  function restart() {
    queryClient.clear();
    setEpoch((n) => n + 1);
  }

  async function signOut() {
    try {
      await posFetch("signout", {});
    } finally {
      restart();
    }
  }

  if (me.isPending) return <Center>Opening the register…</Center>;
  if (me.isError)
    return <Center>Couldn't reach the register. Check the connection and reload the page.</Center>;
  if (!me.data) return <EmailSignIn onSignedIn={restart} />;

  return (
    <SessionContext.Provider
      value={{ api, me: me.data, switchRole: () => void signOut(), resetDemo: async () => {}, hosted: true }}
    >
      <AdminShell me={me.data} onSwitchRole={() => void signOut()} onResetDemo={async () => {}} hosted />
    </SessionContext.Provider>
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
