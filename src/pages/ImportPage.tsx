import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  ensureMaterial, ensureSupplier, fetchCategories, findImportBatch,
  matchMaterial, recordImportBatch,
} from "../lib/queries";
import { parseParticulars } from "../lib/parse";
import { guessCategory } from "../lib/guess";
import { readPurchasesFile } from "../lib/excel";
import type { ParsedLedger } from "../lib/excel";
import { php } from "../lib/format";
import type { ParsedParticulars } from "../lib/types";

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function ImportPage() {
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const [parsed, setParsed] = useState<ParsedLedger | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; sha: string } | null>(null);
  const [dupe, setDupe] = useState<{ line_count: number; grand_total: number } | null>(null);
  const [force, setForce] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? "",
  });

  async function pickFile(f: File | null) {
    setParsed(null); setDupe(null); setResult(null); setError(null); setForce(false);
    if (!f) return;
    try {
      const sha = await sha256Hex(await f.arrayBuffer());
      const ledger = await readPurchasesFile(f);
      setFileMeta({ name: f.name, sha });
      setParsed(ledger);
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

      // 1) Match every distinct particulars string once.
      const distinctTexts = [...new Set(parsed.blocks.flatMap((b) => b.lines.map((l) => l.particulars)))];
      const materialFor = new Map<string, number>();
      const notesFor = new Map<string, string>();
      for (const text of distinctTexts) {
        const m = await matchMaterial(text);
        if (m.material) {
          materialFor.set(text, m.material.id);
          if (m.confidence === "review") {
            notesFor.set(text, `import: fuzzy-matched to “${m.material.search_name}” — verify`);
          }
        } else {
          const parsedFields: ParsedParticulars = parseParticulars(text);
          const cat = guessCategory(text, cats.data);
          const created = await ensureMaterial(cat.id, parsedFields, cat.unit);
          materialFor.set(text, created.id);
          notesFor.set(text, `import: created new material in “${cat.name}”`);
        }
      }

      // 2) Suppliers.
      const distinctSuppliers = [...new Set(parsed.blocks.map((b) => b.supplier).filter(Boolean))];
      const supplierFor = new Map<string, number>();
      for (const s of distinctSuppliers) {
        supplierFor.set(s, (await ensureSupplier(s)).id);
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
            category_id: cats.data ? guessCategory(l.particulars, cats.data).id : null,
            material_id: materialFor.get(l.particulars) ?? null,
            particulars_raw: l.particulars,
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
      setParsed(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <>
      <h1>Import from Excel</h1>
      <p className="muted small">
        Reads PURCHASES (1).xlsx, repairs the known issues (with a full preview), matches every
        item to the material catalog, then writes everything to the database.
      </p>

      <div className="card">
        <label className="field">
          Workbook (.xlsx)
          <input type="file" accept=".xlsx"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        </label>
        {error && <div className="banner err">{error}</div>}
      </div>

      {parsed && (
        <>
          <div className="banner ok">
            <b>{parsed.lineCount}</b> lines in <b>{parsed.blocks.length}</b> invoice blocks ·
            grand total <b>{php(parsed.repairedTotal)}</b> with repairs
            (the original file itself records {php(parsed.storedTotal)}).
          </div>

          {dupe && (
            <div className="banner warn">
              ⚠ This exact file was already imported ({dupe.line_count} lines, {php(Number(dupe.grand_total))}).
              Importing again would duplicate everything.
              <label style={{ display: "block", marginTop: 6 }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />{" "}
                Import anyway (creates duplicates)
              </label>
            </div>
          )}

          <div className="card">
            <h2>Repairs &amp; notes ({parsed.repairs.length})</h2>
            {parsed.repairs.length === 0 && <p className="muted">Nothing to repair.</p>}
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
          </div>

          <div className="card">
            <h2>Invoice blocks</h2>
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
                      <td className="num" style={delta ? { color: "#b3261e", fontWeight: 700 } : undefined}>
                        {b.subtotalStored !== null ? php(b.subtotalStored) : "—"}
                        {delta ? " ≠" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button className="primary" disabled={commit.isPending || (!!dupe && !force)}
            onClick={() => { setError(null); setResult(null); commit.mutate(); }}>
            {commit.isPending ? "Importing…" : `Import ${parsed.lineCount} lines into the database`}
          </button>
          {result && <div className="banner ok">{result}</div>}
        </>
      )}
    </>
  );
}
