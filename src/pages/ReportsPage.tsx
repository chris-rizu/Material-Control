import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPurchasesFlat } from "../lib/queries";
import { php, monthLabel } from "../lib/format";
import { IconReport } from "../components/icons";
import type { PurchaseFlat } from "../lib/types";

function SumTable({ rows, keyOf, label }: {
  rows: PurchaseFlat[];
  keyOf: (r: PurchaseFlat) => string;
  label: string;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, { lines: number; total: number }>();
    for (const r of rows) {
      const k = keyOf(r);
      const g = m.get(k) ?? { lines: 0, total: 0 };
      g.lines += 1;
      g.total += Number(r.amount);
      m.set(k, g);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [rows, keyOf]);

  const grand = groups.reduce((s, [, g]) => s + g.total, 0);

  return (
    <div className="card">
      <div className="card-head">{label}</div>
      <table>
        <thead>
          <tr><th>{label.replace("Spend by ", "")}</th><th className="num">Lines</th><th className="num">Total</th><th className="num">Share</th></tr>
        </thead>
        <tbody>
          {groups.map(([k, g]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="num">{g.lines}</td>
              <td className="num">₱{php(g.total)}</td>
              <td className="num">{grand > 0 ? ((g.total / grand) * 100).toFixed(1) : "0.0"}%</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td>Total</td><td className="num">{rows.length}</td><td className="num">₱{php(grand)}</td><td /></tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: fetchPurchasesFlat });
  if (ledger.isLoading) return <div className="page-loading"><span className="spinner" /> Building reports…</div>;
  const rows = ledger.data ?? [];

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <div className="page-icon"><IconReport size={22} /></div>
          <div>
            <h1>Reports</h1>
            <div className="page-sub">Where the money went — by month, supplier, and category.</div>
          </div>
        </div>
      </div>
      <SumTable rows={rows} keyOf={(r) => monthLabel(r.purchase_date)} label="Spend by month" />
      <SumTable rows={rows} keyOf={(r) => r.supplier ?? "—"} label="Spend by supplier" />
      <SumTable rows={rows} keyOf={(r) => r.category ?? "Uncategorized"} label="Spend by category" />
    </>
  );
}
