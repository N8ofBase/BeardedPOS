import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { isRole } from "@bearded/core";
import { listDemoStaff, type DemoStaff } from "@bearded/db";
import { createDemoApi } from "./api/client.ts";
import { RolePicker } from "./auth/RolePicker.tsx";
import { bootDemo, OtherTabError, type DemoRuntime } from "./demo/boot.ts";
import { AdminShell } from "./layout/AdminShell.tsx";
import { UnsubscribePage } from "./pages/public/UnsubscribePage.tsx";
import { loadPicked, savePicked, SessionContext, type PickedStaff } from "./session.tsx";

type Boot = { state: "loading" } | { state: "ready"; rt: DemoRuntime } | { state: "error"; message: string };

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });

  useEffect(() => {
    bootDemo().then(
      (rt) => setBoot({ state: "ready", rt }),
      (err: unknown) => {
        console.error("Demo startup failed", err);
        setBoot({
          state: "error",
          message:
            err instanceof OtherTabError
              ? err.message
              : "The demo couldn't start in this browser. Try reloading, or use a current version of Chrome, Edge or Safari.",
        });
      },
    );
  }, []);

  if (boot.state === "loading") return <Center>Setting up the demo register…</Center>;
  if (boot.state === "error") return <Center>{boot.message}</Center>;
  // The link in every bulk email; no staff sign-in.
  if (window.location.pathname === "/unsubscribe")
    return <UnsubscribePage db={boot.rt.db} search={window.location.search} />;
  return <Signed rt={boot.rt} />;
}

function Signed({ rt }: { rt: DemoRuntime }) {
  const [picked, setPicked] = useState<PickedStaff | null>(loadPicked);
  const queryClient = useQueryClient();

  const staff = useQuery({ queryKey: ["demo-staff"], queryFn: () => listDemoStaff(rt.db) });

  // A remembered pick from before a reset no longer exists: drop it.
  const current = picked && staff.data?.find((s) => s.id === picked.staffId && s.role === picked.role);

  const api = useMemo(
    () =>
      current && isRole(current.role)
        ? createDemoApi(rt.db, { businessId: current.businessId, staffId: current.id, role: current.role })
        : null,
    [current, rt.db],
  );

  const me = useQuery({
    queryKey: ["me", current?.id],
    queryFn: () => api!.call("me"),
    enabled: !!api,
  });

  function pick(s: DemoStaff) {
    const p = { staffId: s.id, businessId: s.businessId, role: s.role };
    savePicked(p);
    setPicked(p);
  }

  function switchRole() {
    savePicked(null);
    setPicked(null);
    queryClient.removeQueries({ queryKey: ["me"] });
  }

  async function resetDemo() {
    savePicked(null);
    await rt.reset();
    window.location.reload();
  }

  if (staff.isPending) return <Center>Setting up the demo register…</Center>;
  if (staff.isError) return <Center>Couldn't read the demo data. Reload the page to try again.</Center>;
  if (!current || !api) return <RolePicker staff={staff.data} onPick={pick} />;
  if (me.isPending) return <Center>Signing in…</Center>;
  if (me.isError) return <Center>{me.error.message}</Center>;

  return (
    <SessionContext.Provider value={{ api, me: me.data, switchRole, resetDemo }}>
      <AdminShell me={me.data} onSwitchRole={switchRole} onResetDemo={resetDemo} />
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
