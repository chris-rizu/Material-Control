// Read-Only — the same ledger table as Purchases but with no entry row and
// no edit/delete actions: just the data, a search box, and sortable
// Date / Project columns. For viewers who only need to look things up.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPurchasesFlat } from "../lib/queries";
import { displayParticulars, php } from "../lib/format";
import { comparePurchases, type SortDir, type SortKey } from "../lib/sort";
import { IconEye, IconSearch } from "../components/icons";

export default function ReadOnlyPage() {
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: fetchPurchasesFlat });
  const [search, setSearch] = useState("");
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

  const filtered = useMemo(() => {
    const needle = search.toUpperCase();
    const list = needle
      ? rows.filter((r) =>
          r.particulars_raw.toUpperCase().includes(needle) ||
          (r.supplier ?? "").toUpperCase().includes(needle) ||
          r.si_no.toUpperCase().includes(needle) ||
          (r.project_name ?? "").toUpperCase().includes(needle) ||
          (r.material ?? "").toUpperCase().includes(needle))
      : [...rows];
    list.sort((a, b) => comparePurchases(a, b, sortKey, sortDir));
    return list;
  }, [rows, search, sortKey, sortDir]);

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
          <div className="searchbar">
            <IconSearch size={16} />
            <input
              value={search}
              placeholder="Search by SI#, supplier, project, item, or particulars..."
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
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
                      {rows.length === 0 ? "No purchases recorded yet" : "Nothing matches this search"}
                    </div>
                    <div>{rows.length === 0 ? "Lines added in Purchases will appear here." : "Try a shorter search term."}</div>
                  </div>
                </td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.purchase_date}</td>
                  <td>{r.si_no || <span className="muted">—</span>}</td>
                  <td title={r.supplier ?? ""}>{r.supplier}</td>
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
              ))}
            </tbody>
          </table>
        </div>

        <div className="pp-foot">
          <span className="muted small">{filtered.length} items{search ? " (filtered)" : ""}</span>
          <span className="spacer" />
          <span className="muted small">Grand total</span>
          <span className="f-total">₱{php(total)}</span>
        </div>
      </div>
    </>
  );
}
