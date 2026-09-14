// Reports — where the money went. One report at a time, chosen with the tab
// buttons: Monthly Expenditures, By Supplier, By Particulars, By Projects.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPurchasesFlat } from "../lib/queries";
import { displayParticulars, php, monthLabel } from "../lib/format";
import { IconReport } from "../components/icons";
import type { PurchaseFlat } from "../lib/types";

type Tab = "month" | "supplier" | "particulars" | "projects";

interface ReportDef {
  label: string;
  col: string;
  keyOf: (r: PurchaseFlat) => string;
  labelOf: (key: string) => string;
  /** months read newest-first; everything else biggest spend first */
  chronological?: boolean;
}

const REPORTS: Record<Tab, ReportDef> = {
  month: {
    label: "Monthly Expenditures",
    col: "Month",
    keyOf: (r) => r.purchase_date.slice(0, 7),
    labelOf: (k) => monthLabel(k),
    chronological: true,
  },
  supplier: {
    label: "By Supplier",
    col: "Supplier",
    keyOf: (r) => r.supplier ?? "",
    labelOf: (k) => k || "(no supplier)",
  },
  particulars: {
    label: "By Particulars",
    col: "Particulars",
    keyOf: (r) => displayParticulars(r),
    labelOf: (k) => k,
  },
  projects: {
    label: "By Projects",
    col: "Project",
    keyOf: (r) => (r.project_name ?? "").trim().toUpperCase(),
    labelOf: (k) => k || "(no project)",
  },
};

const TAB_ORDER: Tab[] = ["month", "supplier", "particulars", "projects"];

function SumTable({ rows, def }: { rows: PurchaseFlat[]; def: ReportDef }) {
  const groups = useMemo(() => {
    const m = new Map<string, { lines: number; qty: number; total: number }>();
    for (const r of rows) {
      const k = def.keyOf(r);
      const g = m.get(k) ?? { lines: 0, qty: 0, total: 0 };
      g.lines += 1;
      g.qty += Number(r.quantity);
      g.total += Number(r.amount);
      m.set(k, g);
    }
    const list = [...m.entries()];
    return def.chronological
      ? list.sort((a, b) => (a[0] < b[0] ? 1 : -1))
      : list.sort((a, b) => b[1].total - a[1].total);
  }, [rows, def]);

  const grand = groups.reduce((s, [, g]) => s + g.total, 0);

  return (
    <div className="card">
      <div className="card-head">{def.label} <span className="muted small">· {groups.length} rows</span></div>
      <table>
        <thead>
          <tr>
            <th>{def.col}</th>
            <th className="num">Lines</th>
            <th className="num">Qty</th>
            <th className="num">Total</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([k, g]) => (
            <tr key={k}>
              <td className={k ? "" : "muted"}>{def.labelOf(k)}</td>
              <td className="num">{g.lines}</td>
              <td className="num">{Number(g.qty.toFixed(3)).toLocaleString()}</td>
              <td className="num">₱{php(g.total)}</td>
              <td className="num">{grand > 0 ? ((g.total / grand) * 100).toFixed(1) : "0.0"}%</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td>Total</td><td className="num">{rows.length}</td><td /><td className="num">₱{php(grand)}</td><td /></tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: fetchPurchasesFlat });
  const [tab, setTab] = useState<Tab>("month");
  if (ledger.isLoading) return <div className="page-loading"><span className="spinner" /> Building reports…</div>;
  const rows = ledger.data ?? [];

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <div className="page-icon"><IconReport size={22} /></div>
          <div>
            <h1>Reports</h1>
            <div className="page-sub">Where the money went — by month, supplier, particulars, and project.</div>
          </div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="card">
          <div className="empty">
            <IconReport size={40} />
            <div className="e-title">Nothing to report yet</div>
            <div>Reports fill in as you encode or import purchases.</div>
          </div>
        </div>
      ) : (
        <>
          <div className="rep-tabs">
            {TAB_ORDER.map((t) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {REPORTS[t].label}
              </button>
            ))}
          </div>
          <SumTable rows={rows} def={REPORTS[tab]} />
        </>
      )}
    </>
  );
}
