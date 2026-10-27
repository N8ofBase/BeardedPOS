import { createContext, useContext } from "react";
import type { Me } from "@bearded/api";
import type { Api } from "./api/client.ts";

export interface Session {
  api: Api;
  me: Me;
  /** Demo: back to the role picker. Hosted: sign out. */
  switchRole(): void;
  resetDemo(): Promise<void>;
  /** Signed in with an email code on the store's server, not the in-browser demo. */
  hosted?: boolean;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside a signed-in screen");
  return s;
}

const KEY = "bearded.demo.staff";

export interface PickedStaff {
  staffId: string;
  businessId: string;
  role: string;
}

/** The demo's last-picked role, so a reload keeps you signed in. Per device; safe to lose. */
export function loadPicked(): PickedStaff | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PickedStaff) : null;
  } catch {
    return null;
  }
}

export function savePicked(p: PickedStaff | null): void {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the role just won't be remembered.
  }
}
