import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { deletePurchase, fetchCategories, fetchPurchasesFlat } from "../lib/queries";
import { useMe } from "../lib/useMe";
import { useSheetsExport } from "../lib/sheets";
import SheetsExportBanner from "../components/SheetsExportBanner";
import { fmtDate, php, qtyFmt, todayISO } from "../lib/format";
import {
  IconLedger, IconDownload, IconPlus, IconUpload, IconCoins, IconX,
} from "../components/icons";
import type { PurchaseFlat } from "../lib/types";

interface Block {
  key: string;
  date: string;
  siNo: string;
  supplier: string;
  rows: PurchaseFlat[];
}

export default function LedgerPage() {
  const qc = useQueryClient();
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: fetchPurchasesFlat });
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const me = useMe();
  const canWrite = me.data?.role === "owner" || me.data?.role === "encoder";

  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");
  const [cat, setCat] = useState<number | "">("");
  const sheet = useSheetsExport();

  const del = useMutation({
    mutationFn: (id: number) => deletePurchase(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ledger"] }),
  });

  const filtered = useMemo(() => {
    const needle = q.toUpperCase();
    return (ledger.data ?? []).filter((r) => {
      if (month && !r.purchase_date.startsWith(month)) return false;
      if (cat !== "" && r.category_id !== cat) return false;
      if (!needle) return true;
      return (
        r.particulars_raw.toUpperCase().includes(needle) ||
        (r.supplier ?? "").toUpperCase().includes(needle) ||
        r.si_no.toUpperCase().includes(needle) ||
        (r.material ?? "").toUpperCase().includes(needle)
      );
    });
  }, [ledger.data, q, month, cat]);

  const blocks = useMemo<Block[]>(() => {
    const out: Block[] = [];
    for (const r of filtered) {
      const key = `${r.purchase_date}|${r.si_no}|${r.supplier ?? ""}`;
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(r);
      else
        out.push({ key, date: r.purchase_date, siNo: r.si_no, supplier: r.supplier ?? "—", rows: [r] });
    }
    return out;
  }, [filtered]);

  const stats = useMemo(() => {
    const grand = filtered.reduce((s, r) => s + Number(r.amount), 0);
    const thisMonth = todayISO().slice(0, 7);
    const monthTotal = filtered
      .filter((r) => r.purchase_date.startsWith(thisMonth))
      .reduce((s, r) => s + Number(r.amount), 0);
    const bySup = new Map<string, number>();
    for (const r of filtered) {
      const s = r.supplier ?? "—";
      bySup.set(s, (bySup.get(s) ?? 0) + Number(r.amount));
    }
    let top: { name: string; share: number } | null = null;
    for (const [name, v] of bySup) {
      if (grand > 0 && (!top || v > 0) && v === Math.max(...bySup.values())) {
        top = { name, share: Math.round((v / grand) * 1000) / 10 };
      }
    }
    return { grand, monthTotal, thisMonth, invoices: blocks.length, top };
  }, [filtered, blocks]);

  function exportSheets() {
    void sheet.run(ledger.data ?? []);
  }

  if (ledger.isLoading || me.isLoading) {
    return <div className="page-loading"><span className="spinner" /> Loading your ledger…</div>;
  }
  if (ledger.error) return <div className="banner err">{String(ledger.error)}</div>;

  const months = [...new Set((ledger.data ?? []).map((r) => r.purchase_date.slice(0, 7)))].sort().reverse();
  const cols = canWrite ? 5 : 4;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Purchases ledger</h1>
          <div className="page-sub">Every line item, grouped per invoice — like your Excel, but always arithmetically honest.</div>
        </div>
        <div className="page-actions">
          <button onClick={exportSheets} disabled={sheet.exporting || !ledger.data?.length}>
            <IconDownload size={16} /> {sheet.exporting ? "Building…" : "Export to Google Sheets"}
          </button>
        </div>
      </div>

      <SheetsExportBanner result={sheet.result} onClose={sheet.clear} />

      {filtered.length > 0 && (
        <div className="tiles">
          <div className="tile accent">
            <div className="t-label">Total spend</div>
            <div className="t-value">₱{php(stats.grand)}</div>
            <div className="t-sub">{stats.invoices} invoices · {filtered.length} lines</div>
          </div>
          <div className="tile">
            <div className="t-label">This month</div>
            <div className="t-value">₱{php(stats.monthTotal)}</div>
            <div className="t-sub">{stats.thisMonth}</div>
          </div>
          <div className="tile">
            <div className="t-label">Top supplier</div>
            <div className="t-value" style={{ fontSize: 17, paddingTop: 5 }}>{stats.top?.name ?? "—"}</div>
            <div className="t-sub">{stats.top ? `${stats.top.share}% of filtered spend` : ""}</div>
          </div>
          <div className="tile">
            <div className="t-label">Average per invoice</div>
            <div className="t-value">₱{php(stats.invoices ? stats.grand / stats.invoices : 0)}</div>
            <div className="t-sub">across current filter</div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="row">
          <label className="field grow">
            Search
            <input value={q} placeholder="Search particulars, supplier, SI#…"
              onChange={(e) => setQ(e.target.value)} />
          </label>
          <label className="field">
            Month
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">All months</option>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="field">
            Category
            <select value={String(cat)}
              onChange={(e) => setCat(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">All categories</option>
              {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty">
            <IconLedger size={40} />
            <div className="e-title">
              {(ledger.data ?? []).length === 0 ? "No purchases yet" : "Nothing matches this filter"}
            </div>
            <div>
              {(ledger.data ?? []).length === 0
                ? "Bring in your old spreadsheet or start encoding — the ledger fills itself."
                : "Try clearing the search, month or category."}
            </div>
            {(ledger.data ?? []).length === 0 && canWrite && (
              <div className="e-actions">
                <Link to="/import"><button className="primary"><IconUpload size={16} /> Import Excel</button></Link>
                <Link to="/entry"><button><IconPlus size={16} /> Encode an invoice</button></Link>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Particulars</th>
                <th className="num">Unit price</th>
                <th className="num">Qty</th>
                <th className="num">Amount</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => {
                const sub = b.rows.reduce((s, r) => s + Number(r.amount), 0);
                return (
                  <Fragment key={b.key}>
                    <tr className="blockhead">
                      <td colSpan={cols}>
                        <span className="inv-date">{fmtDate(b.date)}</span>
                        <span className="inv-meta"> · {b.siNo ? `SI# ${b.siNo}` : "no invoice #"} · </span>
                        <span className="inv-sup">{b.supplier}</span>
                      </td>
                    </tr>
                    {b.rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.particulars_raw}
                          {r.receipt_quality !== "ok" && (
                            <span className={`chip ${r.receipt_quality === "unreadable" ? "bad" : "warn"}`}>
                              {r.receipt_quality}
                            </span>
                          )}
                          {r.amount_source === "import_missing_filled" && (
                            <span className="chip brand" title="Amount was missing in the original file — filled from price × qty">repaired</span>
                          )}
                          {r.amount_source === "manual" && (
                            <span className="chip" title="Receipt amount kept (rounded at the pump)">receipt</span>
                          )}
                          {r.category && <span className="chip">{r.category}</span>}
                        </td>
                        <td className="num">{php(Number(r.unit_price))}</td>
                        <td className="num">{qtyFmt(Number(r.quantity))}</td>
                        <td className="num">{php(Number(r.amount))}</td>
                        {canWrite && (
                          <td>
                            <button className="icon danger" title="Delete line"
                              onClick={() => { if (confirm(`Delete “${r.particulars_raw}”?`)) del.mutate(r.id); }}>
                              <IconX size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    <tr className="subtotal">
                      <td colSpan={2}>Subtotal — {b.rows.length} line{b.rows.length > 1 ? "s" : ""}</td>
                      <td className="num" colSpan={cols - 2}>{php(sub)}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <IconCoins size={17} /> Grand total — {filtered.length} lines · {blocks.length} invoices
                  </span>
                </td>
                <td className="num">₱{php(stats.grand)}</td>
                {canWrite && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
