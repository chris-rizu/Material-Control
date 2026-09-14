import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureSupplier, fetchPurchasesFlat, fetchSuppliers } from "../lib/queries";
import { php } from "../lib/format";
import { IconTruck } from "../components/icons";

export default function SuppliersPage() {
  const qc = useQueryClient();
  const sups = useQuery({ queryKey: ["suppliers"], queryFn: fetchSuppliers });
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: fetchPurchasesFlat }); // shared cache with Purchases
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () => ensureSupplier(name.trim()),
    onSuccess: (s) => {
      setMsg(`Supplier ready: ${s.name}`);
      setName("");
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  // per-supplier purchase context (null while the ledger is still loading)
  const stats = useMemo(() => {
    if (!ledger.data) return null;
    const m = new Map<number, { lines: number; total: number; last: string }>();
    for (const r of ledger.data) {
      if (r.supplier_id == null) continue;
      const g = m.get(r.supplier_id) ?? { lines: 0, total: 0, last: "" };
      g.lines += 1;
      g.total += Number(r.amount);
      if (r.purchase_date > g.last) g.last = r.purchase_date;
      m.set(r.supplier_id, g);
    }
    return m;
  }, [ledger.data]);

  const rows = useMemo(() => {
    const list = (sups.data ?? []).map((s) => ({ s, g: stats?.get(s.id) }));
    // biggest spenders first once we know the totals; alphabetical otherwise
    return list.sort((a, b) => (b.g?.total ?? 0) - (a.g?.total ?? 0) || a.s.name.localeCompare(b.s.name));
  }, [sups.data, stats]);

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <div className="page-icon"><IconTruck size={22} /></div>
          <div>
            <h1>Suppliers</h1>
            <div className="page-sub">
              The hardware stores and stations you buy from. New ones are created automatically
              while encoding or importing.
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <label className="field grow">
            Add supplier
            <input value={name} placeholder="e.g. CEBU LUCKY MACHINERY, INC."
              onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="primary" disabled={!name.trim() || add.isPending}
            onClick={() => { setMsg(null); add.mutate(); }}>
            Add
          </button>
        </div>
        {msg && <div className="banner ok">{msg}</div>}
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">
            <IconTruck size={40} />
            <div className="e-title">No suppliers yet</div>
            <div>They appear automatically when you encode or import purchases.</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name ({rows.length})</th>
                <th className="num">Lines</th>
                <th className="num">Total spent</th>
                <th className="num">Last purchase</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, g }) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="num">{g ? g.lines.toLocaleString() : "—"}</td>
                  <td className="num">{g ? `₱${php(g.total)}` : "—"}</td>
                  <td className="num muted">{g?.last || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
