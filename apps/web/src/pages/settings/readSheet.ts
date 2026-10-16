import { nonEmptyRows } from "@pet-pos/core";

export interface Sheet {
  fileName: string;
  headers: string[];
  rows: string[][];
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Reads the first sheet of a .csv, .xlsx or .xls file into text cells. CSV is read
 * as plain text so ZIP codes and phone numbers keep their leading zeros; Excel dates
 * come out as YYYY-MM-DD. SheetJS loads only when a file is picked.
 */
export async function readSheet(file: File): Promise<Sheet> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is over 10 MB. Split it into smaller files.");
  const XLSX = await import("xlsx");
  const isCsv = /\.(csv|txt)$/i.test(file.name) || file.type === "text/csv";
  const wb = isCsv
    ? XLSX.read(await file.text(), { type: "string", raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const first = wb.SheetNames[0];
  const ws = first ? wb.Sheets[first] : undefined;
  if (!ws) throw new Error("That file has no sheets in it.");
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: false,
    dateNF: "yyyy-mm-dd",
    defval: "",
    blankrows: false,
  });
  const [head, ...body] = aoa;
  if (!head || head.length === 0) throw new Error("The first row must be column names.");
  const headers = head.map((h) => String(h ?? "").trim());
  const rows = nonEmptyRows(body.map((r) => headers.map((_, i) => String(r[i] ?? ""))));
  if (rows.length === 0) throw new Error("The file needs a header row and at least one data row.");
  return { fileName: file.name, headers, rows };
}
