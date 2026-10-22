import { createContext, useContext } from "react";
import type { BookingPage } from "@pet-pos/api";
import type { PublicApi } from "../api/client.ts";

export interface BookingSession {
  api: PublicApi;
  page: BookingPage;
  /** The signed-in customer's name, or null. */
  name: string | null;
  signIn: (token: string, name: string) => void;
  signOut: () => void;
}

export const BookingContext = createContext<BookingSession | null>(null);

export function useBooking(): BookingSession {
  const s = useContext(BookingContext);
  if (!s) throw new Error("useBooking outside the booking page");
  return s;
}

const KEY = "petpos.customer";

/** The customer's session on this device. Storage can be blocked: then they sign in each visit. */
export function loadCustomer(): { token: string; name: string } | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as { token: string; name: string }) : null;
  } catch {
    return null;
  }
}

export function saveCustomer(c: { token: string; name: string } | null): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: the session just won't outlast the tab.
  }
}
