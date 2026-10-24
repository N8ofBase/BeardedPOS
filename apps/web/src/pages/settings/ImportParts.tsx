// The column-matching table and the preview, kept separate so they can be tested.
import { fieldsFor, type ColumnMapping, type ImportType } from "@bearded/core";
import type { ImportResult } from "@bearded/api";
import type { Sheet } from "./readSheet.ts";

export function ColumnMatcher({
  type,
  sheet,
  mapping,
  onChange,
}: {
  type: ImportType;
  sheet: Sheet;
  mapping: ColumnMapping;
  onChange: (m: ColumnMapping) => void;
}) {
  const fields = fieldsFor(type);
  const samples = (i: number) =>
    sheet.rows
      .map((r) => r[i] ?? "")
      .filter(Boolean)
      .slice(0, 2)
      .join(", ");

  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Column in your file</th>
            <th>Example</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const col = mapping[f.key];
            return (
              <tr key={f.key}>
                <td>
                  <b>{f.label}</b>
                </td>
                <td>
                  <select
                    aria-label={`Column for ${f.label}`}
                    value={col === undefined ? "" : String(col)}
                    onChange={(e) => {
                      const next = { ...mapping };
                      if (e.target.value === "") delete next[f.key];
                      else {
                        const i = Number(e.target.value);
                        // A column feeds one field: take it from any other field first.
                        for (const [k, v] of Object.entries(next)) if (v === i) delete next[k];
                        next[f.key] = i;
                      }
                      onChange(next);
                    }}
                  >
                    <option value="">Not in the file</option>
                    {sheet.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="muted small">{col === undefined ? "" : samples(col)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const ACTION_TAG = { new: ["ok", "New"], update: ["muted", "Update"], skip: ["out", "Skip"] } as const;

export function PreviewView({ result }: { result: ImportResult }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="kpis">
        <Kpi label="Rows in file" value={result.rows} />
        <Kpi label="New" value={result.created} />
        <Kpi label="Updated" value={result.updated} />
        <Kpi label="Skipped" value={result.skipped} />
      </div>

      <SkipsTable skips={result.skips} />

      {result.warnings.length > 0 && (
        <details>
          <summary>
            {result.warnings.length} warning{result.warnings.length === 1 ? "" : "s"}: imported, with a note
            to check
          </summary>
          <ul className="small">
            {result.warnings.slice(0, 100).map((w, i) => (
              <li key={i}>
                Row {w.row}: {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th className="r">Row</th>
              <th>First {result.sample.length} rows</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {result.sample.map((s) => {
              const [cls, text] = ACTION_TAG[s.action];
              return (
                <tr key={s.row}>
                  <td className="r num">{s.row}</td>
                  <td>
                    {s.label}
                    {s.reason && <span className="sub">{s.reason}</span>}
                  </td>
                  <td>
                    <span className={`tag ${cls}`}>{text}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SkipsTable({ skips }: { skips: ImportResult["skips"] }) {
  if (!skips.length) return null;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th className="r">Row</th>
            <th>Why it was skipped</th>
          </tr>
        </thead>
        <tbody>
          {skips.slice(0, 50).map((s) => (
            <tr key={s.row}>
              <td className="r num">{s.row}</td>
              <td>{s.reason}</td>
            </tr>
          ))}
          {skips.length > 50 && (
            <tr>
              <td colSpan={2} className="muted">
                and {(skips.length - 50).toLocaleString("en-US")} more
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="kpi">
      <span className="muted">{label}</span>
      <b className="num">{value.toLocaleString("en-US")}</b>
    </div>
  );
}
