import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  addCategory, ensureMaterial, ensureProject, ensureSupplier, fetchCategories, fetchImportBatches,
  fetchPurchasesFlat, findImportBatch, matchMaterial, recordImportBatch,
} from "../lib/queries";
import { parseParticulars } from "../lib/parse";
import { guessCategoryTarget } from "../lib/guess";
import { readPurchasesFile } from "../lib/excel";
import { useSheetsExport } from "../lib/sheets";
import SheetsExportBanner from "../components/SheetsExportBanner";
import type { ParsedLedger } from "../lib/excel";
import { php } from "../lib/format";
import type { Category, ParsedParticulars } from "../lib/types";
import { IconDownload, IconInvoice, IconUpload } from "../components/icons";

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function ImportPage() {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: fetchPurchasesFlat });
  const imports = useQuery({ queryKey: ["import-batches"], queryFn: fetchImportBatches });
  const [parsed, setParsed] = useState<ParsedLedger | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; sha: string } | null>(null);
  const [dupe, setDupe] = useState<{ line_count: number; grand_total: number } | null>(null);
  const [force, setForce] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const sheet = useSheetsExport();
  const fileInput = useRef<HTMLInputElement>(null);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? "",
  });

  async function pickFile(f: File | null) {
    setParsed(null); setDupe(null); setResult(null); setError(null); setForce(false);
    if (!f) return;
    try {
      const sha = await sha256Hex(await f.arrayBuffer());
      const ledger2 = await readPurchasesFile(f);
      setFileMeta({ name: f.name, sha });
      setParsed(ledger2);
      const existing = await findImportBatch(sha);
      if (existing) setDupe(existing);
    } catch (e) {
      setError(`Could not read that file — is it the PURCHASES workbook? (${String(e)})`);
    }
  }

  const commit = useMutation({
    mutationFn: async () => {
      if (!parsed || !cats.data) throw new Error("Nothing to import.");
      const userId = me.data ?? "";

      // 1) Match every distinct particulars string once. Categories come from
      //    the keyword rules — and any category the rules name that the
      //    database doesn't have yet is ADDED on the spot, so nothing falls
      //    into a wrong bucket just because it was missing.
      const distinctTexts = [...new Set(parsed.blocks.flatMap((b) => b.lines.map((l) => l.particulars)))];
      const materialFor = new Map<string, number>();
      const catFor = new Map<string, number>();
      const notesFor = new Map<string, string>();
      const knownCats: Category[] = [...(cats.data ?? [])];
      const ensureCat = async (target: { name: string; unit: string }): Promise<Category> => {
        let c = knownCats.find((k) => k.name.toUpperCase() === target.name.toUpperCase());
        if (!c) {
          c = await addCategory(target.name, target.unit);
          knownCats.push(c);
        }
        return c;
      };
      for (const text of distinctTexts) {
        const m = await matchMaterial(text);
        if (m.material) {
          materialFor.set(text, m.material.id);
          catFor.set(text, m.material.category_id);
          if (m.confidence === "review") {
            notesFor.set(text, `import: fuzzy-matched to “${m.material.search_name}” — verify`);
          }
        } else {
          const parsedFields: ParsedParticulars = parseParticulars(text);
          const cat = await ensureCat(guessCategoryTarget(text));
          const created = await ensureMaterial(cat.id, parsedFields, cat.unit);
          materialFor.set(text, created.id);
          catFor.set(text, cat.id);
          notesFor.set(text, `import: created new material in “${cat.name}”`);
        }
      }

      // 2) Suppliers.
      const distinctSuppliers = [...new Set(parsed.blocks.map((b) => b.supplier).filter(Boolean))];
      const supplierFor = new Map<string, number>();
      for (const s of distinctSuppliers) {
        supplierFor.set(s, (await ensureSupplier(s)).id);
      }

      // 2b) Projects — the app's export carries per-line project names, so a
      // round-trip re-import restores the catalog too (best-effort, optional).
      const distinctProjects = [
        ...new Set(parsed.blocks.flatMap((b) => b.lines.map((l) => l.project)).filter(Boolean)),
      ];
      for (const p of distinctProjects) {
        try { await ensureProject(p); } catch { /* catalog is optional */ }
      }

      // 3) Build purchase rows.
      const rows: Record<string, unknown>[] = [];
      for (const block of parsed.blocks) {
        block.lines.forEach((l, i) => {
          const recomputed = Math.round(l.unitPrice * l.quantity * 100) / 100;
          let amount = recomputed;
          let source = "computed";
          if (l.amountStored !== null) {
            amount = l.amountStored;
            source = Math.abs(l.amountStored - recomputed) > 0.01 ? "manual" : "computed";
          } else {
            source = "import_missing_filled";
          }
          rows.push({
            purchase_date: l.date,
            si_no: l.siNo,
            supplier_id: supplierFor.get(l.supplier) ?? null,
            category_id: catFor.get(l.particulars) ?? null,
            material_id: materialFor.get(l.particulars) ?? null,
            particulars_raw: l.particulars,
            project_name: l.project,
            attributes: {},
            unit_price: l.unitPrice,
            quantity: l.quantity,
            amount,
            amount_source: source,
            receipt_quality: l.receiptQuality,
            line_seq: i,
            notes: notesFor.get(l.particulars) ?? "",
            created_by: userId,
          });
        });
      }

      // 4) Insert in chunks.
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from("purchases").insert(rows.slice(i, i + 200));
        if (error) throw error;
      }

      // 5) Record the batch (idempotency guard).
      await recordImportBatch(fileMeta?.name ?? "file", fileMeta?.sha ?? "", parsed.lineCount, parsed.repairedTotal, userId);
      return { count: rows.length, total: parsed.repairedTotal, stored: parsed.storedTotal };
    },
    onSuccess: (r) => {
      setResult(`Imported ${r.count} lines. Grand total with repairs: ${php(r.total)} (as recorded in the original file: ${php(r.stored)}).`);
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["materials"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["import-batches"] });
      setParsed(null);
      if (fileInput.current) fileInput.current.value = "";
    },
    onError: (e: Error) => setError(e.message),
  });

  function exportSheets() {
    void sheet.run(ledger.data ?? []);
  }

  const lastImport = imports.data?.[0];
  const lineCount = ledger.data?.length ?? 0;

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <div className="page-icon"><IconUpload size={22} /></div>
          <div>
            <h1>Import / Export</h1>
            <div className="page-sub">
              Bring the Excel ledger in, or take your data out. Importing only
              ever adds lines — nothing in the database is replaced or deleted.
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- EXPORT ---------------- */}
      <div className="card">
        <div className="card-head"><IconDownload size={16} /> Export to Google Sheets</div>
        <p className="muted small" style={{ margin: "0 0 12px" }}>
          Builds the full ledger as a new Google Sheets tab and opens it — every line,
          same columns and look as the original workbook. In Google Sheets,{" "}
          <b>File → Download → Microsoft Excel</b> gives a copy that imports back here.
        </p>
        <div className="imp-actions" style={{ justifyContent: "flex-start" }}>
          <button onClick={exportSheets} disabled={sheet.exporting || lineCount === 0}>
            <IconDownload size={15} /> {sheet.exporting ? "Building…" : `Export ${lineCount.toLocaleString()} lines`}
          </button>
          {lastImport && (
            <span className="muted small">
              Last import: <b>{lastImport.filename}</b> · {lastImport.line_count} lines ·{" "}
              {php(Number(lastImport.grand_total))}
            </span>
          )}
        </div>
        {sheet.result && <div style={{ marginTop: 12 }}><SheetsExportBanner result={sheet.result} onClose={sheet.clear} /></div>}
      </div>

      {/* ---------------- IMPORT ---------------- */}
      <div className="card">
        <div className="card-head"><IconUpload size={16} /> Import from Excel</div>
        <div
          className={"dropzone" + (dragOver ? " over" : "")}
          role="button" tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void pickFile(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <span className="dz-icon"><IconUpload size={26} /></span>
          <span className="dz-main">
            {fileMeta ? fileMeta.name : "Drop the PURCHASES workbook here"}
          </span>
          <span className="dz-sub">
            {fileMeta
              ? "Loaded — preview below. Click to choose a different file."
              : "or click to browse — .xlsx only, repairs are previewed before anything is saved"}
          </span>
        </div>
        <input ref={fileInput} type="file" accept=".xlsx" style={{ display: "none" }}
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />

        {error && <div className="banner err">{error}</div>}
        {result && <div className="banner ok">{result}</div>}

        {parsed && (
          <>
            <div className="imp-stats">
              <div className="imp-stat">
                <div className="v">{parsed.lineCount.toLocaleString()}</div>
                <div className="l">Lines</div>
              </div>
              <div className="imp-stat">
                <div className="v">{parsed.blocks.length}</div>
                <div className="l">Invoice blocks</div>
              </div>
              <div className="imp-stat">
                <div className="v">{php(parsed.repairedTotal)}</div>
                <div className="l">Grand total · repaired</div>
              </div>
              <div className="imp-stat">
                <div className="v">{php(parsed.storedTotal)}</div>
                <div className="l">As recorded in file</div>
              </div>
            </div>

            {dupe && (
              <div className="banner warn">
                ⚠ This exact file was already imported ({dupe.line_count} lines,{" "}
                {php(Number(dupe.grand_total))}). Importing again would duplicate everything.
                <label style={{ display: "block", marginTop: 6 }}>
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />{" "}
                  Import anyway (creates duplicates)
                </label>
              </div>
            )}

            <div className="card" style={{ margin: "14px 0 0" }}>
              <div className="card-head"><IconInvoice size={16} /> Repairs &amp; notes ({parsed.repairs.length})</div>
              {parsed.repairs.length === 0 && <p className="muted small">Nothing to repair.</p>}
              {parsed.repairs.length > 0 && (
                <table>
                  <thead><tr><th>Excel row</th><th>Kind</th><th>What happens</th></tr></thead>
                  <tbody>
                    {parsed.repairs.map((r, i) => (
                      <tr key={i}>
                        <td className="num">{r.row}</td>
                        <td><span className="chip">{r.kind}</span></td>
                        <td>{r.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card" style={{ margin: "14px 0 0" }}>
              <div className="card-head"><IconInvoice size={16} /> Invoice blocks</div>
              <table>
                <thead>
                  <tr><th>Date</th><th>SI#</th><th>Supplier</th><th className="num">Lines</th>
                    <th className="num">Lines sum</th><th className="num">Old subtotal (col H)</th></tr>
                </thead>
                <tbody>
                  {parsed.blocks.map((b, i) => {
                    const sum = b.lines.reduce((s, l) => s + (l.amountStored ?? Math.round(l.unitPrice * l.quantity * 100) / 100), 0);
                    const delta = b.subtotalStored !== null && Math.abs(b.subtotalStored - sum) > 0.01;
                    return (
                      <tr key={i}>
                        <td>{b.date}</td>
                        <td>{b.siNo || "—"}</td>
                        <td>{b.supplier}</td>
                        <td className="num">{b.lines.length}</td>
                        <td className="num">{php(sum)}</td>
                        <td className={"num" + (delta ? " imp-delta" : "")}>
                          {b.subtotalStored !== null ? php(b.subtotalStored) : "—"}
                          {delta ? " ≠" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="imp-actions">
              {commit.isPending && <span className="muted small">Matching materials and writing lines…</span>}
              <button disabled={commit.isPending}
                onClick={() => { if (fileInput.current) fileInput.current.value = ""; pickFile(null); }}>
                Cancel
              </button>
              <button className="primary" disabled={commit.isPending || (!!dupe && !force)}
                onClick={() => { setError(null); setResult(null); commit.mutate(); }}>
                {commit.isPending ? "Importing…" : `Import ${parsed.lineCount} lines into the database`}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
