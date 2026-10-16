// Turning spreadsheet cells into stored values. Each parser returns null for a blank
// cell and undefined when the cell has something it can't read.
import { isIsoDate, todayIso } from "../dates.ts";
import type { PetSize, Species } from "../pets.ts";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 2024-03-07, 2024/3/7, 3/7/2024, 3-7-2024, 3.7.2024 or 3/7/24. A two-digit year is this
 * century unless that would be in the future, so "85" is 1985.
 */
export function parseLooseDate(s: string, today: string = todayIso()): string | null | undefined {
  const t = s.trim();
  if (!t) return null;
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(t);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
    if (!match) return undefined;
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (match[3]!.length === 2) {
      const thisYear = Number(today.slice(0, 4));
      y = 2000 + y > thisYear ? 1900 + y : 2000 + y;
    }
  }
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return isIsoDate(iso) ? iso : undefined;
}

export function parseYesNo(s: string): boolean | null | undefined {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (["yes", "y", "true", "1", "x", "opted in", "opt in"].includes(t)) return true;
  if (["no", "n", "false", "0", "opted out", "opt out"].includes(t)) return false;
  return undefined;
}

/** dog / cat / other. "Rabbit" becomes other, with the animal kept as the breed hint. */
export function parseSpecies(s: string): { species: Species; hint: string | null } | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (/^(dog|puppy|canine|k9)$/.test(t)) return { species: "dog", hint: null };
  if (/^(cat|kitten|feline)$/.test(t)) return { species: "cat", hint: null };
  if (t === "other") return { species: "other", hint: null };
  return { species: "other", hint: s.trim() };
}

export function parseSize(s: string): PetSize | null | undefined {
  const t = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!t) return null;
  if (["s", "small", "sm"].includes(t)) return "S";
  if (["m", "medium", "med", "md"].includes(t)) return "M";
  if (["l", "large", "lg"].includes(t)) return "L";
  if (["xl", "xlarge", "extralarge", "giant"].includes(t)) return "XL";
  return undefined;
}

/** A whole number of 0 or more: "12", "1,200", "12.0". */
export function parseCount(s: string): number | null | undefined {
  const t = s.trim().replace(/,/g, "");
  if (!t) return null;
  if (!/^\d+(\.0+)?$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Excel drops leading zeros: a 4-digit ZIP like 2134 is 02134. */
export function normalizeZip(s: string): string | null | undefined {
  const t = s.trim();
  if (!t) return null;
  if (/^\d{4}$/.test(t)) return `0${t}`;
  if (/^\d{5}(-\d{4})?$/.test(t)) return t;
  if (/^\d{9}$/.test(t)) return `${t.slice(0, 5)}-${t.slice(5)}`;
  return undefined;
}

export interface PetFromCell {
  name: string;
  species: Species | null;
  breed: string | null;
}

const OTHER_ANIMAL =
  /\b(rabbit|bunny|ferret|guinea pig|hamster|gerbil|chinchilla|rat|mouse|bird|parrot|parakeet|cockatiel|budgie|fish|turtle|tortoise|lizard|gecko|bearded dragon|snake|reptile|hedgehog|pig)\b/i;

/** The prototype's pets cell: "Biscuit (beagle), Mo (cat), Clover (rabbit)". Commas inside () don't split. */
export function parsePetsCell(cell: string): PetFromCell[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of cell) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = /^([^(]+?)\s*(?:\((.*)\))?\s*$/.exec(p);
      const name = (m?.[1] ?? p).trim();
      const info = (m?.[2] ?? "").trim();
      if (!info) return { name, species: null, breed: null };
      const toks = info.split(/\s*[,·]\s*/).filter(Boolean);
      const first = (toks[0] ?? "").toLowerCase();
      const rest = toks.slice(1).join(", ") || null;
      if (/^(dog|puppy)$/.test(first)) return { name, species: "dog", breed: rest };
      if (/^(cat|kitten)$/.test(first)) return { name, species: "cat", breed: rest };
      if (first === "other") return { name, species: "other", breed: rest };
      if (OTHER_ANIMAL.test(info)) return { name, species: "other", breed: info };
      if (/\b(cat|kitten)\b/i.test(info))
        return { name, species: "cat", breed: info.replace(/\b(cat|kitten)\b,?\s*/i, "").trim() || null };
      return { name, species: "dog", breed: info.replace(/\b(dog|puppy)\b,?\s*/i, "").trim() || null };
    });
}
