import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import {
  autoMatch,
  can,
  IMPORT_TYPE_KEYS,
  IMPORT_TYPES,
  mapRows,
  mappingProblems,
  templateCsv,
  type ColumnMapping,
  type ImportType,
} from "@bearded/core";
import { CHUNK_SIZE, MAX_ROWS, type ImportBatchRow, type ImportResult, type UndoResult } from "@bearded/api";
import { useSession } from "../../session.tsx";
import { ConfirmTyped } from "../../ui/ConfirmTyped.tsx";
import { errorMessage } from "../../ui/errors.ts";
import { useToast } from "../../ui/Toast.tsx";
import { ColumnMatcher, PreviewView, SkipsTable } from "./ImportParts.tsx";
import { readSheet, type Sheet } from "./readSheet.ts";

type Step = "pick" | "map" | "preview" | "importing" | "done";

interface Done {
  batch: ImportBatchRow;
  skips: ImportResult["skips"];
}

export function ImportPage() {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<ImportType>("customers");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [step, setStep] = useState<Step>("pick");
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [fileKey, setFileKey] = useState(0);

  const runPreview = useMutation({
    mutationFn: () => api.call("previewImport", { type, rows: mapRows(sheet!.rows, mapping) }),
    onSuccess: (res) => {
      setPreview(res);
      setStep("preview");
    },
    onError: (err) => toast(errorMessage(err)),
  });

  if (!can(me.staff.role, "import.run"))
    return <p className="muted">Importing is for owners and managers.</p>;

  function reset(keepType = true) {
    setSheet(null);
    setMapping({});
    setPreview(null);
    setProgress(null);
    setDone(null);
    setFileError(null);
    setStep("pick");
    setFileKey((k) => k + 1);
    if (!keepType) setType("customers");
  }

  async function pickFile(file: File | undefined) {
    setFileError(null);
    setPreview(null);
    if (!file) return;
    try {
      const s = await readSheet(file);
      if (s.rows.length > MAX_ROWS)
        throw new Error(
          `That file has ${s.rows.length.toLocaleString("en-US")} rows. Files can have up to ${MAX_ROWS.toLocaleString("en-US")}.`,
        );
      setSheet(s);
      setMapping(autoMatch(type, s.headers));
      setStep("map");
    } catch (err) {
      setSheet(null);
      setFileError(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  function changeType(t: ImportType) {
    setType(t);
    setPreview(null);
    if (sheet) {
      setMapping(autoMatch(t, sheet.headers));
      setStep("map");
    }
  }

  async function runImport() {
    if (!sheet) return;
    const rows = mapRows(sheet.rows, mapping);
    setStep("importing");
    setProgress({ done: 0, total: rows.length });
    try {
      const { batchId } = await api.call("startImport", {
        type,
        fileName: sheet.fileName,
        totalRows: rows.length,
      });
      const skips: ImportResult["skips"] = [];
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const res = await api.call("importChunk", {
          batchId,
          offset: i,
          rows: rows.slice(i, i + CHUNK_SIZE),
        });
        skips.push(...res.skips);
        setProgress({ done: Math.min(i + CHUNK_SIZE, rows.length), total: rows.length });
      }
      const batch = await api.call("finishImport", { batchId });
      setDone({ batch, skips });
      setStep("done");
      toast(`Imported ${(batch.created + batch.updated).toLocaleString("en-US")} rows`);
    } catch (err) {
      toast(errorMessage(err));
      setStep("preview");
    } finally {
      for (const key of ["customers", "customer", "products", "product", "programs", "imports"])
        void qc.invalidateQueries({ queryKey: [key] });
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([templateCsv(type)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const problems = mappingProblems(type, mapping);

  return (
    <>
      <div className="page-head">
        <div>
          <Link to=".." className="small">
            ← Settings
          </Link>
          <h1>Bulk import</h1>
        </div>
      </div>

      <section className="panel">
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Upload a CSV or Excel file saved from a spreadsheet or exported from your old system. The first row
          must be column names. Nothing is saved until you check the preview and tap Import, and every import
          can be undone.
        </p>
        <div className="form" style={{ alignItems: "end" }}>
          <label>
            What's in the file
            <select
              value={type}
              onChange={(e) => changeType(e.target.value as ImportType)}
              disabled={step === "importing"}
            >
              {IMPORT_TYPE_KEYS.map((t) => (
                <option key={t} value={t}>
                  {IMPORT_TYPES[t].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            File (.csv or .xlsx)
            <input
              key={fileKey}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv"
              onChange={(e) => void pickFile(e.target.files?.[0])}
              disabled={step === "importing"}
            />
          </label>
          <div>
            <button type="button" onClick={downloadTemplate}>
              Download template
            </button>
          </div>
        </div>
        <p className="muted small" style={{ maxWidth: "75ch" }}>
          {IMPORT_TYPES[type].help}
        </p>
        {fileError && <p className="error-box">{fileError}</p>}
      </section>

      {sheet && (step === "map" || step === "preview") && (
        <section className="panel" style={{ maxWidth: "none" }}>
          <h2>
            Match columns · {sheet.fileName} ({sheet.rows.length.toLocaleString("en-US")} rows)
          </h2>
          <ColumnMatcher
            type={type}
            sheet={sheet}
            mapping={mapping}
            onChange={(m) => {
              setMapping(m);
              setPreview(null);
              setStep("map");
            }}
          />
          {problems.map((p) => (
            <p key={p} className="field-error">
              {p}
            </p>
          ))}
          {step === "map" && (
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={problems.length > 0 || runPreview.isPending}
                onClick={() => runPreview.mutate()}
              >
                {runPreview.isPending ? "Checking the file…" : "Preview"}
              </button>
              <button type="button" onClick={() => reset()}>
                Start over
              </button>
            </div>
          )}
        </section>
      )}

      {preview && step === "preview" && (
        <section className="panel" style={{ maxWidth: "none" }}>
          <h2>Preview</h2>
          <PreviewView result={preview} />
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={preview.created + preview.updated === 0}
              onClick={() => void runImport()}
            >
              Import {(preview.created + preview.updated).toLocaleString("en-US")} row
              {preview.created + preview.updated === 1 ? "" : "s"}
            </button>
            <button type="button" onClick={() => reset()}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {step === "importing" && progress && (
        <section className="panel">
          <h2>Importing…</h2>
          <p role="status">
            Saved {progress.done.toLocaleString("en-US")} of {progress.total.toLocaleString("en-US")}
          </p>
          <progress max={progress.total} value={progress.done} style={{ width: "100%" }} />
        </section>
      )}

      {step === "done" && done && (
        <section className="panel">
          <h2>Import finished</h2>
          <p>
            {done.batch.created.toLocaleString("en-US")} new, {done.batch.updated.toLocaleString("en-US")}{" "}
            updated, {done.batch.skipped.toLocaleString("en-US")} skipped.
          </p>
          <SkipsTable skips={done.skips} />
          <div className="actions">
            <button type="button" className="primary" onClick={() => reset()}>
              Import another file
            </button>
          </div>
        </section>
      )}

      <PastImports />
    </>
  );
}

const ENTITY_WORD: Record<string, [string, string]> = {
  customer: ["customer", "customers"],
  product: ["product", "products"],
};

const countOf = (entity: string, n: number) => {
  const [one, many] = ENTITY_WORD[entity] ?? [entity, entity];
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
};

function PastImports() {
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [undoing, setUndoing] = useState<ImportBatchRow | null>(null);
  const [lastUndo, setLastUndo] = useState<UndoResult | null>(null);
  const imports = useQuery({ queryKey: ["imports"], queryFn: () => api.call("listImports") });

  return (
    <section style={{ display: "grid", gap: 10 }}>
      <h2>Past imports</h2>
      {undoing && (
        <UndoConfirm
          batch={undoing}
          onCancel={() => setUndoing(null)}
          onConfirm={async () => {
            try {
              const res = await api.call("undoImport", { batchId: undoing.id });
              setLastUndo(res);
              toast("Import undone");
              setUndoing(null);
              for (const key of ["customers", "customer", "products", "product", "programs", "imports"])
                void qc.invalidateQueries({ queryKey: [key] });
            } catch (err) {
              toast(errorMessage(err));
            }
          }}
        />
      )}
      {lastUndo && lastUndo.kept.length > 0 && (
        <div className="note">
          <b>Some changes were kept</b>
          <span>These were edited after the import, so undo left them as they are now:</span>
          <ul className="small" style={{ margin: 0 }}>
            {lastUndo.kept.slice(0, 50).map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="tablewrap">
        <table className="wide">
          <thead>
            <tr>
              <th>When</th>
              <th>File</th>
              <th>Type</th>
              <th>By</th>
              <th className="r">New</th>
              <th className="r">Updated</th>
              <th className="r">Skipped</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {imports.data?.map((b) => (
              <tr key={b.id}>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  {new Date(b.createdAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </td>
                <td>{b.fileName}</td>
                <td>{IMPORT_TYPES[b.type].label}</td>
                <td>{b.staffName ?? "—"}</td>
                <td className="r num">{b.created}</td>
                <td className="r num">{b.updated}</td>
                <td className="r num">{b.skipped}</td>
                <td>
                  {b.status === "undone" ? (
                    <span className="tag muted">Undone</span>
                  ) : (
                    <button type="button" className="danger" onClick={() => setUndoing(b)}>
                      Undo
                    </button>
                  )}
                  {b.status === "running" && <span className="tag low"> Stopped partway</span>}
                </td>
              </tr>
            ))}
            {imports.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No imports yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UndoConfirm({
  batch,
  onCancel,
  onConfirm,
}: {
  batch: ImportBatchRow;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { api } = useSession();
  const preview = useQuery({
    queryKey: ["undo-preview", batch.id],
    queryFn: () => api.call("undoPreview", { batchId: batch.id }),
  });
  if (preview.isPending) return <p className="muted">Checking what this import changed…</p>;
  if (preview.isError) return <p className="error-box">{errorMessage(preview.error)}</p>;
  const creates = new Intl.ListFormat("en-US").format(
    Object.entries(preview.data.creates).map(([k, n]) => countOf(k, n)),
  );
  return (
    <ConfirmTyped
      title={`Undo the import of ${batch.fileName}?`}
      button="Undo import"
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>
        {creates ? `This deletes the ${creates} this import added` : "This import added nothing new"}
        {preview.data.updates
          ? `, and puts back ${preview.data.updates.toLocaleString("en-US")} change${preview.data.updates === 1 ? "" : "s"} it made to existing records`
          : ""}
        .
      </p>
      <p className="muted">
        Anything edited since the import is kept as it is now. Stock counts the import changed are put back
        with a new stock move, so the history stays complete.
      </p>
    </ConfirmTyped>
  );
}
