import { addDays, daysBetween, isIsoDate, todayIso } from "./dates.ts";

export const SPECIES = ["dog", "cat", "other"] as const;
export type Species = (typeof SPECIES)[number];
export const SPECIES_LABEL: Record<Species, string> = { dog: "Dog", cat: "Cat", other: "Other" };

export const SIZES = ["S", "M", "L", "XL"] as const;
export type PetSize = (typeof SIZES)[number];

/** Placeholder for the "Breed or notes" box, by type (from the prototype). */
export const BREED_PLACEHOLDER: Record<Species, string> = {
  dog: "e.g. beagle",
  cat: "e.g. Maine coon",
  other: "e.g. rabbit, ferret, bird",
};

export const DUPLICATE_PET_MESSAGE =
  "Two pets have the same name. Add a last initial or nickname to tell them apart.";

/** Pet names must be unique per customer, ignoring case. Returns the prototype's message, or null. */
export function duplicatePetName(names: string[]): string | null {
  const seen = new Set<string>();
  for (const n of names) {
    const k = n.trim().toLowerCase();
    if (!k) continue;
    if (seen.has(k)) return DUPLICATE_PET_MESSAGE;
    seen.add(k);
  }
  return null;
}

export const VACCINES = ["Rabies", "DHPP", "Bordetella", "Leptospirosis", "FVRCP", "FeLV", "Other"] as const;

export type VaccineStatus = "expired" | "due" | "ok";

/** Expired before today; due when it expires within 30 days (including today); otherwise ok. */
export function vaccineStatus(expiresOn: string, today: string = todayIso()): VaccineStatus {
  if (!isIsoDate(expiresOn)) return "expired";
  if (daysBetween(today, expiresOn) < 0) return "expired";
  if (expiresOn <= addDays(today, 30)) return "due";
  return "ok";
}

/** The spec blocks booking once rabies has lapsed (Phase 3); screens warn about it now. */
export function rabiesLapsed(
  vaccinations: { vaccine: string; expiresOn: string }[],
  today: string = todayIso(),
) {
  const rabies = vaccinations.find((v) => v.vaccine.trim().toLowerCase() === "rabies");
  return rabies ? vaccineStatus(rabies.expiresOn, today) === "expired" : false;
}
