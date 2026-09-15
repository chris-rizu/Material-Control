// Read-Only — the same ledger table as Purchases but with no entry row and
// no edit/delete actions. The search/filter toolbar is the SAME engine as
// Purchases (shared lib/filter.ts + PredictiveSearchInput): text search with
// value suggestions, date range, supplier, project, status and category.
// For viewers who only need to look things up.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCategories, fetchPurchasesFlat, fetchSuppliers } from "../lib/queries";
import { filterPurchases, anyFilterOn, sameInvoiceBlock } from "../lib/filter";
import { displayParticulars, php } from "../lib/format";
import { comparePurchases, type SortDir, type SortKey } from "../lib/sort";
import PredictiveSearchInput from "../components/PredictiveSearchInput";
import { IconCalendar, IconEye } from "../components/icons";

export default function ReadOnlyPage() {
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: fetchPurchasesFlat });
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const sups = useQuery({ queryKey: ["suppliers"], queryFn: fetchSuppliers });
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supId, setSupId] = useState<number | "">("");
  const [proj, setProj] = useState("");
  const [status, setStatus] = useState("");
  const [cat, setCat] = useState<number | "">("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  }

  const rows = ledger.data ?? [];

  // distinct project names for the toolbar dropdown (case-insensitive,
  // first-seen casing kept, blanks never listed)
  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const p = (r.project_name ?? "").trim();
      if (p && !seen.has(p.toUpperCase())) seen.set(p.toUpperCase(), p);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [rows]);

  const filters = { search, dateFrom, dateTo, supId, proj, status, cat };
  const filtered = useMemo(() => {
    const list = filterPurchases(rows, filters);
    list.sort((a, b) => comparePurchases(a, b, sortKey, sortDir));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, dateFrom, dateTo, supId, proj, status, cat, sortKey, sortDir]);

  const anyFilter = anyFilterOn(filters);

  function clearFilters() {
    setSearch(""); setDateFrom(""); setDateTo("");
    setSupId(""); setProj(""); setStatus(""); setCat("");
  }

  const total = filtered.reduce((s, r) => s + Number(r.amount), 0);

  if (ledger.isLoading) {
    return <div className="page-loading"><span className="spinner" /> Loading your purchases…</div>;
  }
  if (ledger.error) return <div className="banner err">{String(ledger.error)}</div>;

  const sortInd = (key: SortKey) =>
    sortKey === key ? <span className="sort-ind">{sortDir === "asc" ? "▲" : "▼"}</span> : null;

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <div className="page-icon"><IconEye size={22} /></div>
          <div>
            <h1>Read-Only</h1>
            <div className="page-sub">The full purchases ledger — search and sort only, nothing can be changed here.</div>
          </div>
        </div>
      </div>

      <div className="card pp-card">
        <div className="pp-toolbar">
          <PredictiveSearchInput
            value={search}
            onChange={setSearch}
            rows={rows}
            placeholder="Search by SI#, supplier, item, project, or particulars..."
          />
          <div className="pp-seg" title="Date range">
            <IconCalendar size={15} />
            <input type="date" value={dateFrom} max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)} />
            <span className="muted">–</span>
            <input type="date" value={dateTo} min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="pp-seg">
            <select value={String(supId)}
              onChange={(e) => setSupId(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">All Suppliers</option>
              {(sups.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="pp-seg" title="Filter by project">
            <select value={proj} onChange={(e) => setProj(e.target.value)}>
              <option value="">All Projects</option>
              {projects.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="pp-seg">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="ok">OK</option>
              <option value="no-invoice">No invoice</option>
              <option value="unreadable">Unreadable</option>
              <option value="repaired">Repaired</option>
              <option value="receipt">Receipt-rounded</option>
            </select>
          </div>
          <div className="pp-seg">
            <select value={String(cat)}
              onChange={(e) => setCat(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">All Categories</option>
              {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button className="pp-clear" onClick={clearFilters}>Clear</button>
        </div>

        <div className="pp-scroll">
          <table className="pp-table">
            <thead>
              <tr>
                <th className="sortable" style={{ width: "12%" }} onClick={() => toggleSort("date")}
                  title="Sort by date">
                  Date {sortInd("date")}
                </th>
                <th style={{ width: "12%" }}>SI#</th>
                <th style={{ width: "19%" }}>Supplier</th>
                <th style={{ width: "24%" }}>Particulars</th>
                <th className="sortable" style={{ width: "11%" }} onClick={() => toggleSort("project")}
                  title="Sort by project name">
                  Project {sortInd("project")}
                </th>
                <th className="num" style={{ width: "10%" }}>Unit Price</th>
                <th className="num" style={{ width: "6%" }}>Qty</th>
                <th className="num" style={{ width: "11%" }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8}>
                  <div className="empty">
                    <IconEye size={40} />
                    <div className="e-title">
                      {rows.length === 0 ? "No purchases recorded yet" : "Nothing matches these filters"}
                    </div>
                    <div>{rows.length === 0
                      ? "Lines added in Purchases will appear here."
                      : "Try widening the date range or clearing the filters."}</div>
                  </div>
                </td></tr>
              )}
              {filtered.map((r, idx) => {
                // ledger convention: same day + SI# + supplier as the row
                // above = the same receipt, so those cells stay blank
                const contd = idx > 0 && sameInvoiceBlock(filtered[idx - 1], r);
                return (
                <tr key={r.id}>
                  <td title={contd ? "Same day, receipt and supplier as the line above" : undefined}>
                    {contd ? "" : r.purchase_date}
                  </td>
                  <td>{contd ? "" : (r.si_no || <span className="muted">—</span>)}</td>
                  <td title={r.supplier ?? ""}>{contd ? "" : r.supplier}</td>
                  <td title={displayParticulars(r) === r.particulars_raw
                    ? r.particulars_raw
                    : `${displayParticulars(r)}\nAs typed: ${r.particulars_raw}`}>
                    {displayParticulars(r)}
                  </td>
                  <td title={r.project_name ?? ""}>{r.project_name || <span className="muted">—</span>}</td>
                  <td className="num">₱{php(Number(r.unit_price))}</td>
                  <td className="num">{Number(r.quantity)}</td>
                  <td className="num">₱{php(Number(r.amount))}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="pp-foot">
          <span className="muted small">{filtered.length} items{anyFilter ? " (filtered)" : ""}</span>
          <span className="spacer" />
          <span className="muted small">Grand total</span>
          <span className="f-total">₱{php(total)}</span>
        </div>
      </div>
    </>
  );
}
