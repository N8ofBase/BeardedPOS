import { isIsoDate, todayIso } from "./dates.ts";
import { normalizePhone } from "./phone.ts";
import type { FieldErrors } from "./product.ts";
import type { CustomerKind } from "./crm.ts";

export interface CustomerInput {
  name: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  birthday: string;
  smsOptIn: boolean;
  notes: string;
  /** Left out by older callers (import, the register's quick add): a person who hasn't opted in. */
  kind?: CustomerKind;
  /** A retailer's store name. */
  company?: string;
  wholesaleTerms?: string;
  emailOptIn?: boolean;
}

/** What gets stored: trimmed, blanks as null, phone as 10 digits, state upper-case. */
export interface CleanCustomer {
  name: string;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  birthday: string | null;
  smsOptIn: boolean;
  notes: string | null;
  kind: CustomerKind;
  company: string | null;
  wholesaleTerms: string | null;
  emailOptIn: boolean;
}

const blank = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCustomer(c: CustomerInput, today: string = todayIso()): FieldErrors<CustomerInput> {
  const e: FieldErrors<CustomerInput> = {};
  if (!c.name.trim()) e.name = "Name is required.";
  const phone = blank(c.phone);
  const email = blank(c.email);
  if (phone && !normalizePhone(phone)) e.phone = "Enter a 10-digit phone number.";
  if (email && !EMAIL.test(email)) e.email = "Enter an email like name@example.com.";
  if (!phone && !email) e.phone = "Enter a phone number or an email, so you can find this customer again.";
  const state = blank(c.state);
  if (state && !/^[A-Za-z]{2}$/.test(state)) e.state = "Use the 2-letter state, like NY.";
  const zip = blank(c.zip);
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) e.zip = "Enter a 5-digit ZIP.";
  if (c.kind !== undefined && c.kind !== "person" && c.kind !== "retailer")
    e.kind = "Pick Person or Retailer.";
  const company = blank(c.company);
  if (c.kind === "retailer" && !company) e.company = "Add the store's name.";
  else if (company && company.length > 120) e.company = "Keep the store name under 120 characters.";
  if ((c.wholesaleTerms ?? "").trim().length > 500) e.wholesaleTerms = "Keep the terms under 500 characters.";
  if (c.emailOptIn && !email) e.email = "Add an email address to send them email.";
  const bday = blank(c.birthday);
  if (bday && !isIsoDate(bday)) e.birthday = "Enter a real date.";
  else if (bday && bday > today) e.birthday = "Birthday can't be in the future.";
  return e;
}

export function cleanCustomer(c: CustomerInput): CleanCustomer {
  return {
    name: c.name.trim(),
    phone: normalizePhone(c.phone),
    email: blank(c.email),
    street: blank(c.street),
    city: blank(c.city),
    state: blank(c.state)?.toUpperCase() ?? null,
    zip: blank(c.zip),
    birthday: blank(c.birthday),
    smsOptIn: c.smsOptIn,
    notes: blank(c.notes),
    kind: c.kind ?? "person",
    company: c.kind === "retailer" ? blank(c.company) : null,
    wholesaleTerms: c.kind === "retailer" ? blank(c.wholesaleTerms) : null,
    emailOptIn: !!c.emailOptIn && !!blank(c.email),
  };
}

/** "12 Main St, Springfield, IL 62701", from whichever parts are filled in. */
export function addressLine(c: {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}) {
  const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [c.street, cityLine].filter(Boolean).join(", ");
}
