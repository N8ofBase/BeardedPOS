import { IMPORT_TYPES, type FieldDef, type ImportType } from "./types.ts";

/** "Phone #", "phone_number", " PHONE NUMBER " → "phone number". */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** field key → column index in the file. */
export type ColumnMapping = Record<string, number>;

const PET_COL = /^pet\s*(\d{1,2})\s*(name|breed|type|species|kind|birthday|birth date|dob)$/;
const PET_PART: Record<string, "name" | "breed" | "type" | "birthday"> = {
  name: "name",
  breed: "breed",
  type: "type",
  species: "type",
  kind: "type",
  birthday: "birthday",
  "birth date": "birthday",
  dob: "birthday",
};

/** The fields for a file: the type's own, plus numbered pet columns found in the headers. */
export function fieldsFor(type: ImportType, headers: string[]): FieldDef[] {
  const base = IMPORT_TYPES[type].fields;
  if (type !== "customers") return base;
  const extra: FieldDef[] = [];
  for (const h of headers) {
    const m = PET_COL.exec(normalizeHeader(h));
    if (!m) continue;
    const part = PET_PART[m[2]!]!;
    const key = `pet${Number(m[1])}.${part}`;
    if (!extra.some((x) => x.key === key))
      extra.push({ key, label: `Pet ${Number(m[1])} ${part}`, aliases: [normalizeHeader(h)], sample: "" });
  }
  extra.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return [...base, ...extra];
}

/** Matches each field to the first unused column whose header is one of its aliases. */
export function autoMatch(type: ImportType, headers: string[]): ColumnMapping {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const field of fieldsFor(type, headers)) {
    const aliases = new Set(field.aliases.map(normalizeHeader));
    const i = norm.findIndex((h, idx) => !used.has(idx) && aliases.has(h));
    if (i >= 0) {
      mapping[field.key] = i;
      used.add(i);
    }
  }
  return mapping;
}

/** What still has to be picked before the file can be imported. */
export function mappingProblems(type: ImportType, mapping: ColumnMapping): string[] {
  return IMPORT_TYPES[type].needs.filter((n) => !n.anyOf.some((k) => k in mapping)).map((n) => n.message);
}

/** Data rows (header row excluded) → objects keyed by field, trimmed, blank when unmapped. */
export function mapRows(rows: string[][], mapping: ColumnMapping): Record<string, string>[] {
  const entries = Object.entries(mapping);
  return rows.map((r) => {
    const o: Record<string, string> = {};
    for (const [key, i] of entries) o[key] = String(r[i] ?? "").trim();
    return o;
  });
}

/** Drops rows with nothing in them (trailing blank lines in spreadsheets). */
export function nonEmptyRows(rows: string[][]): string[][] {
  return rows.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
}
