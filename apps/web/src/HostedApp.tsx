import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PIN_RULES } from "@bearded/core";
import type { Me } from "@bearded/api";
import { createHttpApi, posFetch, SignedOutError } from "./api/http.ts";
import { EmailSignIn } from "./auth/EmailSignIn.tsx";
import { MyPinButton } from "./auth/PinSettings.tsx";
import { PinSignIn, type TabletInfo } from "./auth/PinSignIn.tsx";
import { AdminShell } from "./layout/AdminShell.tsx";
import { SessionContext } from "./session.tsx";

const NO_TABLET: TabletInfo = { tablet: null, staff: [] };

/**
 * The register on the store's server: staff sign in with an email code or, on a tablet an owner or
 * manager has set up, with their name and PIN. Every call goes over HTTPS.
 */
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

  // Is this a counter tablet set up for PINs, and who can sign in on it. Any trouble just means email.
  const tablet = useQuery({
    queryKey: ["tablet", epoch],
    queryFn: async () => {
      try {
        return await posFetch<TabletInfo>("tablet", {});
      } catch {
        return NO_TABLET;
      }
    },
  });
  const [useEmail, setUseEmail] = useState(false);
  const onTablet = !!tablet.data?.tablet;

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

  // On a shared tablet, the register locks itself after a while with no taps.
  const signedIn = !!me.data;
  useEffect(() => {
    if (!onTablet || !signedIn) return;
    let timer = setTimeout(lock, PIN_RULES.idleMinutes * 60_000);
    function lock() {
      void signOut();
    }
    function touch() {
      clearTimeout(timer);
      timer = setTimeout(lock, PIN_RULES.idleMinutes * 60_000);
    }
    const events = ["pointerdown", "keydown"] as const;
    for (const e of events) window.addEventListener(e, touch);
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, touch);
    };
    // signOut only restarts the session; it doesn't need to reset the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onTablet, signedIn]);

  if (me.isPending || (!me.data && tablet.isPending)) return <Center>Opening the register…</Center>;
  if (me.isError)
    return <Center>Couldn't reach the register. Check the connection and reload the page.</Center>;
  if (!me.data) {
    const info = tablet.data ?? NO_TABLET;
    if (info.tablet && info.staff.length > 0 && !useEmail)
      return <PinSignIn info={info} onSignedIn={restart} onUseEmail={() => setUseEmail(true)} />;
    return (
      <EmailSignIn
        onSignedIn={() => {
          setUseEmail(false);
          restart();
        }}
        onUsePin={info.tablet && info.staff.length > 0 ? () => setUseEmail(false) : undefined}
      />
    );
  }

  return (
    <SessionContext.Provider
      value={{ api, me: me.data, switchRole: () => void signOut(), resetDemo: async () => {}, hosted: true }}
    >
      <AdminShell
        me={me.data}
        onSwitchRole={() => void signOut()}
        onResetDemo={async () => {}}
        hosted
        signOutLabel={onTablet ? "Lock" : "Sign out"}
        whoExtra={<MyPinButton />}
      />
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
