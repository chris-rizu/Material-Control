// Purchases — the home screen, per the approved mockup:
// connected filter bar (search + date range + suppliers + statuses + categories)
// sitting on top of the entry row and the table, with the right rail
// (Totals, By Category donut, Recent Activity, Quick Actions).
// Suppliers get a typo guard: typed name is matched against existing
// suppliers, and a near-match asks "did you mean?" before creating anything.
// Date and Project Name columns are sortable (click the header).

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  deletePurchase, ensureMaterial, ensureSupplier, fetchCategories,
  fetchImportBatches, fetchPurchasesFlat, fetchSuppliers, matchMaterial, updatePurchase,
} from "../lib/queries";
import { parseParticulars } from "../lib/parse";
import { guessCategory } from "../lib/guess";
import { matchSuppliers } from "../lib/supplierMatch";
import { buildPurchasesWorkbook } from "../lib/excel";
import { displayParticulars, php, todayISO } from "../lib/format";
import { comparePurchases, type SortDir, type SortKey } from "../lib/sort";
import PredictiveMaterialInput from "../components/PredictiveMaterialInput";
import SupplierInput from "../components/SupplierInput";
import {
  IconInvoice, IconCalculator, IconTag, IconClock, IconBolt, IconPanelRight,
  IconDownload, IconUpload, IconX, IconPencil, IconTrash,
  IconCheckCircle, IconCheck, IconInfo, IconArrowRight, IconSearch,
  IconBox, IconUsers, IconCalendar,
} from "../components/icons";
import type { PurchaseFlat, Supplier } from "../lib/types";

interface Draft {
  date: string;
  si: string;
  supplier: string;
  brand: string;
  particulars: string;
  project: string;
  price: string;
  qty: string;
}

const emptyDraft = (): Draft => ({
  date: todayISO(),
  si: "",
  supplier: "",
  brand: "",
  particulars: "",
  project: "",
  price: "",
  qty: "",
});

const VIZ = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const OTHERS = "#94a3b8";

function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function PurchasePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: fetchPurchasesFlat });
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const sups = useQuery({ queryKey: ["suppliers"], queryFn: fetchSuppliers });
  const imports = useQuery({ queryKey: ["import-batches"], queryFn: fetchImportBatches });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      const pid = data.user?.id;
      if (!pid) return { id: "", role: "viewer" as string };
      const { data: prof } = await supabase.from("profiles").select("role").eq("id", pid).maybeSingle();
      return { id: pid, role: (prof?.role as string) ?? "viewer" };
    },
  });
  const canWrite = me.data?.role === "owner" || me.data?.role === "encoder";

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [supId, setSupId] = useState<number | "">("");
  const [proj, setProj] = useState("");
  const [status, setStatus] = useState("");
  const [cat, setCat] = useState<number | "">("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editId, setEditId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  // which material is currently picked in the entry / edit row — when the
  // user switches to a different item, the unit price follows its last price
  const [draftMatId, setDraftMatId] = useState<number | null>(null);
  const [editMatId, setEditMatId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  // sortable headers (Date, Project Name) — newest-first by default
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [railOpen, setRailOpen] = useState(() => {
    try { return localStorage.getItem("mc-rail") !== "hidden"; } catch { return true; }
  });
  function toggleRail() {
    setRailOpen((o) => {
      const next = !o;
      try { localStorage.setItem("mc-rail", next ? "open" : "hidden"); } catch { /* private mode */ }
      return next;
    });
  }
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  }

  // supplier typo guard: set when the user confirms a brand-new supplier name
  const [supForceNew, setSupForceNew] = useState(false);
  const [supSuggest, setSupSuggest] = useState<{ typed: string; candidates: Supplier[] } | null>(null);
  const [editSupNew, setEditSupNew] = useState(false);

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

  const filtered = useMemo(() => {
    const needle = search.toUpperCase();
    const list = rows.filter((r) => {
      if (dateFrom && r.purchase_date < dateFrom) return false;
      if (dateTo && r.purchase_date > dateTo) return false;
      if (supId !== "" && r.supplier_id !== supId) return false;
      if (proj !== "" && (r.project_name ?? "").trim().toUpperCase() !== proj.toUpperCase()) return false;
      if (cat !== "" && r.category_id !== cat) return false;
      if (status === "repaired" && r.amount_source !== "import_missing_filled") return false;
      if (status === "receipt" && r.amount_source !== "manual") return false;
      if ((status === "ok" || status === "no-invoice" || status === "unreadable") && r.receipt_quality !== status) return false;
      if (!needle) return true;
      return (
        r.particulars_raw.toUpperCase().includes(needle) ||
        (r.supplier ?? "").toUpperCase().includes(needle) ||
        r.si_no.toUpperCase().includes(needle) ||
        (r.project_name ?? "").toUpperCase().includes(needle) ||
        (r.material ?? "").toUpperCase().includes(needle)
      );
    });
    list.sort((a, b) => comparePurchases(a, b, sortKey, sortDir));
    return list;
  }, [rows, search, dateFrom, dateTo, supId, proj, status, cat, sortKey, sortDir]);

  const anyFilter = Boolean(search || dateFrom || dateTo || supId !== "" || proj || status || cat !== "");

  function clearFilters() {
    setSearch(""); setDateFrom(""); setDateTo("");
    setSupId(""); setProj(""); setStatus(""); setCat("");
  }

  const stats = useMemo(() => {
    const qty = filtered.reduce((s, r) => s + Number(r.quantity), 0);
    const amount = filtered.reduce((s, r) => s + Number(r.amount), 0);
    const ym = todayISO().slice(0, 7);
    const now = new Date();
    const lastYm = (() => {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    let thisM = 0, lastM = 0;
    for (const r of rows) {
      if (r.purchase_date.startsWith(ym)) thisM += Number(r.amount);
      else if (r.purchase_date.startsWith(lastYm)) lastM += Number(r.amount);
    }
    const deltaPct = lastM > 0 ? Math.round(((thisM - lastM) / lastM) * 1000) / 10 : null;
    return { items: filtered.length, qty, amount, deltaPct };
  }, [filtered, rows]);

  const catData = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const r of filtered) {
      const c = r.category ?? "Uncategorized";
      byCat.set(c, (byCat.get(c) ?? 0) + 1);
    }
    const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 6).map(([name, count], i) => ({ name, count, color: VIZ[i] }));
    const restCount = sorted.slice(6).reduce((s, [, c]) => s + c, 0);
    if (restCount > 0) top.push({ name: "Others", count: restCount, color: OTHERS });
    return { slices: top, total: filtered.length };
  }, [filtered]);

  const feed = useMemo(() => {
    const items: { when: string; icon: "ok" | "info"; title: string; sub: string }[] = [];
    for (const b of imports.data ?? []) {
      items.push({
        when: b.imported_at,
        icon: "ok",
        title: "Import completed",
        sub: `${b.line_count} lines imported · ${b.filename}`,
      });
    }
    for (const r of [...rows].sort((a, b) => (b.created_at > a.created_at ? 1 : -1)).slice(0, 3)) {
      items.push({
        when: r.created_at,
        icon: "info",
        title: "New purchase added",
        sub: `${r.si_no || "no SI#"} · ${r.supplier ?? ""}`,
      });
    }
    return items.sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, 3);
  }, [imports.data, rows]);

  // ---- mutations -----------------------------------------------------------

  const saveRow = useMutation({
    mutationFn: async (d: Draft) => {
      if (!d.date) throw new Error("Pick a date first.");
      if (!d.supplier.trim()) throw new Error("Type the supplier.");
      if (!d.particulars.trim()) throw new Error("Type what was bought.");
      const price = Number(d.price);
      if (d.price === "" || Number.isNaN(price)) throw new Error("Type the unit price.");
      const qty = d.qty === "" ? 1 : Number(d.qty);
      // the entry row's Brand box is optional: filled, it is prepended to the
      // particulars ("MOLDEX" + "PVC TEE 3X3" -> "MOLDEX PVC TEE 3X3"); blank
      // saves just the particulars. A particular that already starts with the
      // brand (e.g. picked whole from the suggestions) is not doubled.
      const b = d.brand.trim().toUpperCase().replace(/\s+/g, " ");
      const base = d.particulars.trim();
      const dupe = base.toUpperCase() === b || base.toUpperCase().startsWith(`${b} `);
      const text = b && !dupe ? `${b} ${base}` : base;

      const supplier = await ensureSupplier(d.supplier.trim());
      let materialId: number | null = null;
      try {
        const m = await matchMaterial(text);
        if (m.material) materialId = m.material.id;
        else if (cats.data) {
          const cat = guessCategory(text, cats.data);
          materialId = (await ensureMaterial(cat.id, parseParticulars(text), cat.unit)).id;
        }
      } catch { /* prediction is best-effort; the row still saves */ }

      const { error } = await supabase.from("purchases").insert({
        purchase_date: d.date,
        si_no: d.si,
        supplier_id: supplier.id,
        category_id: cats.data ? guessCategory(text, cats.data).id : null,
        material_id: materialId,
        particulars_raw: text,
        project_name: d.project.trim(),
        unit_price: price,
        quantity: qty,
        amount_source: "computed",
        receipt_quality: d.si === "" || d.si === "N/A" ? "no-invoice" : "ok",
        line_seq: rows.filter(
          (r) => r.purchase_date === d.date && r.si_no === d.si && (r.supplier ?? "") === supplier.name,
        ).length,
        created_by: me.data?.id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setMsg(null);
      setSupForceNew(false);
      setSupSuggest(null);
      setDraft((d) => ({ ...d, brand: "", particulars: "", project: "", price: "", qty: "" }));
      setDraftMatId(null);
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["materials"] });
      qc.invalidateQueries({ queryKey: ["material-search"] }); // fresh last-prices in the dropdown
    },
    onError: (e: Error) => setMsg({ kind: "err", text: e.message }),
  });

  /**
   * Supplier typo guard: exact (case/space-insensitive) match saves directly;
   * a near-match shows "did you mean?" first; only when nothing similar
   * exists — or the user confirms — do we create a new supplier.
   */
  function trySave() {
    const name = draft.supplier.trim();
    if (name) {
      const { exact, candidates } = matchSuppliers(name, sups.data ?? []);
      if (!exact && !supForceNew) {
        if (candidates.length) {
          setSupSuggest({ typed: name, candidates });
          return;
        }
        // nothing similar — it really is a new supplier; no need to ask
        setSupForceNew(true);
      }
    }
    saveRow.mutate(draft);
  }

  function useCandidate(name: string) {
    const d = { ...draft, supplier: name };
    setDraft(d);
    setSupSuggest(null);
    setSupForceNew(false);
    saveRow.mutate(d);
  }

  function addNewAnyway() {
    setSupSuggest(null);
    setSupForceNew(true);
    saveRow.mutate(draft);
  }

  const commitEdit = useMutation({
    mutationFn: async (args: { id: number; d: Draft }) => {
      const { id, d } = args;
      if (!d.date) throw new Error("Date is required.");
      if (!d.particulars.trim()) throw new Error("Particulars are required.");
      const price = Number(d.price);
      const qty = d.qty === "" ? 1 : Number(d.qty);
      if (d.price === "" || Number.isNaN(price)) throw new Error("Unit price must be a number.");
      if (d.supplier.trim()) {
        // same typo guard as the entry row: near-match must be confirmed
        const { exact, candidates } = matchSuppliers(d.supplier.trim(), sups.data ?? []);
        if (!exact && candidates.length && !editSupNew) {
          throw new Error(
            `“${d.supplier.trim()}” doesn’t match an existing supplier — pick a suggestion from the dropdown, or type the name exactly.`,
          );
        }
      }
      const supplier = await ensureSupplier(d.supplier.trim() || "—");
      await updatePurchase(id, {
        purchase_date: d.date,
        si_no: d.si,
        supplier_id: supplier.id,
        particulars_raw: d.particulars.trim(),
        project_name: d.project.trim(),
        unit_price: price,
        quantity: qty,
        amount: Math.round(price * qty * 100) / 100,
        amount_source: "computed",
      });
      try {
        const m = await matchMaterial(d.particulars);
        if (m.material) await updatePurchase(id, { material_id: m.material.id });
      } catch { /* best-effort */ }
    },
    onSuccess: () => {
      setEditId(null);
      setEditSupNew(false);
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["material-search"] }); // fresh last-prices in the dropdown
    },
    onError: (e: Error) => setMsg({ kind: "err", text: e.message }),
  });

  const del = useMutation({
    mutationFn: (id: number) => deletePurchase(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ledger"] }),
  });

  function startEdit(r: PurchaseFlat) {
    setEditId(r.id);
    setEditSupNew(false);
    setEditMatId(r.material_id ?? null); // the row's own price belongs to this material
    setEditDraft({
      date: r.purchase_date,
      si: r.si_no,
      supplier: r.supplier ?? "",
      brand: "", // the edit row has no Brand box — particulars are edited as one line
      particulars: r.particulars_raw,
      project: r.project_name ?? "",
      price: String(Number(r.unit_price)),
      qty: String(Number(r.quantity)),
    });
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const blob = await buildPurchasesWorkbook(
        rows.map((r) => ({
          purchase_date: r.purchase_date,
          si_no: r.si_no,
          supplier: r.supplier,
          particulars_raw: r.particulars_raw,
          unit_price: Number(r.unit_price),
          quantity: Number(r.quantity),
          amount: Number(r.amount),
          line_seq: r.line_seq,
        })),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `PURCHASES_export_${todayISO()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (ledger.isLoading || me.isLoading) {
    return <div className="page-loading"><span className="spinner" /> Loading your purchases…</div>;
  }
  if (ledger.error) return <div className="banner err">{String(ledger.error)}</div>;

  const draftAmount =
    Math.round((Number(draft.price) || 0) * (draft.qty === "" ? 1 : Number(draft.qty)) * 100) / 100;

  const sortInd = (key: SortKey) =>
    sortKey === key ? <span className="sort-ind">{sortDir === "asc" ? "▲" : "▼"}</span> : null;

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <div className="page-icon"><IconInvoice size={22} /></div>
          <div>
            <h1>Purchases</h1>
            <div className="page-sub">Record your purchase line by line. The system calculates everything for you.</div>
          </div>
        </div>
        <div className="page-actions">
          {canWrite && <Link to="/import"><button><IconUpload size={16} /> Import (Excel)</button></Link>}
          <button onClick={exportExcel} disabled={exporting || rows.length === 0}>
            <IconDownload size={16} /> {exporting ? "Building…" : "Export (Excel)"}
          </button>
        </div>
      </div>

      <div className={"cols" + (railOpen ? "" : " cols-norail")}>
        <div className="main">
          <div className="card pp-card">
            <div className="pp-toolbar">
              <div className="searchbar">
                <IconSearch size={16} />
                <input
                  value={search}
                  placeholder="Search by SI#, supplier, item, project, or particulars..."
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
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

            {canWrite && (
              <div className="pp-draft">
                <input className="pp-f pp-date" type="date" value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
                <input className="pp-f" placeholder="SI#" value={draft.si}
                  onChange={(e) => setDraft({ ...draft, si: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && trySave()} />
                <div className="pp-sup">
                  <SupplierInput
                    value={draft.supplier}
                    suppliers={sups.data ?? []}
                    placeholder="Select supplier"
                    onEnter={() => void trySave()}
                    onChange={(t) => {
                      setDraft({ ...draft, supplier: t });
                      setSupForceNew(false);
                      setSupSuggest(null);
                    }}
                  />
                </div>
                <input className="pp-f pp-brand" placeholder="Brand" title="Brand — optional"
                  value={draft.brand}
                  onChange={(e) => setDraft({ ...draft, brand: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && trySave()} />
                <div className="pp-part">
                  <PredictiveMaterialInput
                    value={draft.particulars}
                    placeholder="Particulars"
                    onChange={(t) => setDraft({ ...draft, particulars: t })}
                    onPick={(hit) => {
                      // switching to a different material pulls its last paid
                      // price into UNIT PRICE; re-picking the same item (e.g.
                      // after fixing a typo) never touches a typed price
                      if (hit && hit.id !== draftMatId) {
                        setDraftMatId(hit.id);
                        if (hit.last_unit_price != null) {
                          setDraft((dr) => ({ ...dr, price: String(hit.last_unit_price) }));
                        }
                      }
                    }}
                    onEnter={() => void trySave()}
                  />
                </div>
                <input className="pp-f pp-proj" placeholder="Project" value={draft.project}
                  onChange={(e) => setDraft({ ...draft, project: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && trySave()} />
                <input className="pp-f pp-num" type="number" step="0.01" placeholder="Unit Price" value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && trySave()} />
                <input className="pp-f pp-num pp-qty" type="number" step="0.001" placeholder="Qty" value={draft.qty}
                  onChange={(e) => setDraft({ ...draft, qty: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && trySave()} />
                <div className="amount-preview">₱{php(draftAmount)}</div>
                <button className="primary pp-add" disabled={saveRow.isPending}
                  onClick={() => void trySave()}>
                  {saveRow.isPending ? <span className="spinner" style={{ borderTopColor: "#fff" }} /> : "Add"}
                </button>
              </div>
            )}

            <div className="pp-scroll">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th className="sortable" style={{ width: "11%" }} onClick={() => toggleSort("date")}
                      title="Sort by date">
                      Date {sortInd("date")}
                    </th>
                    <th style={{ width: "11%" }}>SI#</th>
                    <th style={{ width: "17%" }}>Supplier</th>
                    <th style={{ width: "21%" }}>Particulars</th>
                    <th className="sortable" style={{ width: "10%" }} onClick={() => toggleSort("project")}
                      title="Sort by project name">
                      Project {sortInd("project")}
                    </th>
                    <th className="num" style={{ width: "9.5%" }}>Unit Price</th>
                    <th className="num" style={{ width: "6%" }}>Qty</th>
                    <th className="num" style={{ width: "10.5%" }}>Subtotal</th>
                    {canWrite && <th style={{ width: "7%" }} />}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={canWrite ? 9 : 8}>
                      <div className="empty">
                        <IconInvoice size={40} />
                        <div className="e-title">
                          {rows.length === 0 ? "No purchases here yet" : "Nothing matches these filters"}
                        </div>
                        <div>
                          {rows.length === 0
                            ? "Add your first line in the row above, or import the old Excel file."
                            : "Try widening the date range or clearing the search."}
                        </div>
                        {rows.length === 0 && canWrite && (
                          <div className="e-actions">
                            <Link to="/import"><button className="primary"><IconUpload size={16} /> Import (Excel)</button></Link>
                          </div>
                        )}
                      </div>
                    </td></tr>
                  )}
                  {filtered.map((r) => {
                    const editing = editId === r.id;
                    const d = editing ? editDraft : null;
                    return (
                      <tr key={r.id} className={editing ? "editing" : ""}>
                        <td>{editing
                          ? <input type="date" value={d!.date} onChange={(e) => setEditDraft({ ...d!, date: e.target.value })} />
                          : r.purchase_date}</td>
                        <td>{editing
                          ? <input value={d!.si} onChange={(e) => setEditDraft({ ...d!, si: e.target.value })} />
                          : (r.si_no || <span className="muted">—</span>)}</td>
                        <td title={r.supplier ?? ""}>{editing
                          ? <SupplierInput
                              value={d!.supplier}
                              suppliers={sups.data ?? []}
                              onChange={(t) => {
                                setEditDraft({ ...d!, supplier: t });
                                setEditSupNew(false);
                              }}
                            />
                          : r.supplier}</td>
                        <td title={displayParticulars(r) === r.particulars_raw
                          ? r.particulars_raw
                          : `${displayParticulars(r)}\nAs typed: ${r.particulars_raw}`}>{editing
                          ? <PredictiveMaterialInput
                              value={d!.particulars}
                              placeholder="Particulars"
                              onChange={(t) => setEditDraft({ ...d!, particulars: t })}
                              onPick={(hit) => {
                                // same rule as the entry row: a different item
                                // brings its own last price; same item keeps
                                // whatever price is typed
                                if (hit && hit.id !== editMatId) {
                                  setEditMatId(hit.id);
                                  if (hit.last_unit_price != null) {
                                    setEditDraft((dr) => ({ ...dr, price: String(hit.last_unit_price) }));
                                  }
                                }
                              }}
                            />
                          : <>
                              {displayParticulars(r)}
                              {r.receipt_quality !== "ok" && (
                                <span className={`chip ${r.receipt_quality === "unreadable" ? "bad" : "warn"}`}>{r.receipt_quality}</span>
                              )}
                              {r.amount_source === "import_missing_filled" && <span className="chip brand">repaired</span>}
                              {r.amount_source === "manual" && <span className="chip">receipt</span>}
                            </>}</td>
                        <td title={r.project_name ?? ""}>{editing
                          ? <input value={d!.project} placeholder="—"
                              onChange={(e) => setEditDraft({ ...d!, project: e.target.value })} />
                          : (r.project_name || <span className="muted">—</span>)}</td>
                        <td className="num">{editing
                          ? <input className="mono" type="number" step="0.01" value={d!.price} onChange={(e) => setEditDraft({ ...d!, price: e.target.value })} />
                          : `₱${php(Number(r.unit_price))}`}</td>
                        <td className="num">{editing
                          ? <input className="mono" type="number" step="0.001" value={d!.qty} onChange={(e) => setEditDraft({ ...d!, qty: e.target.value })} />
                          : Number(r.quantity)}</td>
                        <td className="num">₱{php(Number(r.amount))}</td>
                        {canWrite && (
                          <td className="actions">
                            {editing ? (
                              <>
                                <button className="icon primary" title="Save (Enter)"
                                  onClick={() => commitEdit.mutate({ id: r.id, d: editDraft })}><IconCheck size={15} /></button>
                                <button className="icon" title="Cancel (Esc)" onClick={() => setEditId(null)}><IconX size={14} /></button>
                              </>
                            ) : (
                              <>
                                <button className="iconbtn" title="Edit line" onClick={() => startEdit(r)}><IconPencil size={15} /></button>
                                <button className="iconbtn" title="Delete line"
                                  onClick={() => { if (confirm(`Delete “${r.particulars_raw}”?`)) del.mutate(r.id); }}>
                                  <IconTrash size={15} />
                                </button>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pp-foot">
              <span className="muted small">{stats.items} items{anyFilter ? " (filtered)" : ""}</span>
              <span className="spacer" />
              <span className="muted small">Grand total</span>
              <span className="f-total">₱{php(stats.amount)}</span>
            </div>
          </div>

          {supSuggest && (
            <div className="banner warn">
              <div>
                <b>“{supSuggest.typed}”</b> doesn’t match an existing supplier. Did you mean:
                <div className="b-actions">
                  {supSuggest.candidates.map((c, i) => (
                    <button key={c.id} className={i === 0 ? "primary" : ""}
                      onClick={() => useCandidate(c.name)}>
                      Use “{c.name}”
                    </button>
                  ))}
                  <button onClick={addNewAnyway}>
                    Add “{supSuggest.typed}” as a new supplier
                  </button>
                </div>
              </div>
            </div>
          )}

          {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}
        </div>

        {railOpen && (
        <aside className="rail">
          <button className="rail-min" title="Minimize panel" onClick={toggleRail}><IconX size={13} /></button>
          <div className="card">
            <div className="card-head"><IconCalculator size={16} /> Totals (Current File)</div>
            <div className="stat-row"><span className="s-label">Total Items</span><span className="s-value">{stats.items.toLocaleString()}</span></div>
            <div className="stat-row"><span className="s-label">Total Quantity</span><span className="s-value">{stats.qty.toLocaleString()}</span></div>
            <div className="stat-row"><span className="s-label">Total Amount</span><span className="s-value big">₱{php(stats.amount)}</span></div>
            {stats.deltaPct !== null && (
              <div className="stat-row">
                <span className="delta">
                  {stats.deltaPct >= 0 ? "↑" : "↓"} {stats.deltaPct >= 0 ? "+" : ""}{stats.deltaPct}%
                </span>
                <span className="s-label">vs last month</span>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head"><IconTag size={16} /> By Category</div>
            {catData.total === 0 ? (
              <div className="muted small">No data for this view.</div>
            ) : (
              <>
                <div className="donut-wrap">
                  <svg width={104} height={104} viewBox="0 0 104 104">
                    {(() => {
                      const R = 38;
                      const C = 2 * Math.PI * R;
                      let offset = 0;
                      return catData.slices.map((s) => {
                        const frac = s.count / catData.total;
                        const len = frac * C;
                        const el = (
                          <circle
                            key={s.name}
                            cx={52} cy={52} r={R}
                            fill="none"
                            stroke={s.color}
                            strokeWidth={14}
                            strokeDasharray={`${Math.max(len - 2, 0.5)} ${C - len + 2}`}
                            strokeDashoffset={-offset}
                            transform="rotate(-90 52 52)"
                          />
                        );
                        offset += len;
                        return el;
                      });
                    })()}
                    <text x={52} y={49} textAnchor="middle" className="donut-center">{catData.total}</text>
                    <text x={52} y={63} textAnchor="middle" className="donut-center-sub">Items</text>
                  </svg>
                </div>
                <div className="legend">
                  {catData.slices.map((s) => (
                    <div className="lg" key={s.name}>
                      <span className="swatch" style={{ background: s.color }} />
                      <span className="lg-name">{s.name}</span>
                      <span className="lg-count">{s.count}</span>
                      <span className="lg-pct">{((s.count / catData.total) * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-head"><IconClock size={16} /> Recent Activity</div>
            <div className="feed">
              {feed.length === 0 && <div className="muted small">Nothing yet — saved lines and imports appear here.</div>}
              {feed.map((f, i) => (
                <div className="f-item" key={i}>
                  <div className={`f-ico ${f.icon}`}>
                    {f.icon === "ok" ? <IconCheckCircle size={15} /> : <IconInfo size={15} />}
                  </div>
                  <div>
                    <div className="f-title">{f.title}</div>
                    <div className="f-sub">{f.sub}</div>
                  </div>
                  <span className="f-when">{relTime(f.when)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><IconBolt size={16} /> Quick Actions</div>
            <div className="qa-list">
              {canWrite && (
                <button className="qa" onClick={() => navigate("/import")}>
                  <IconUpload size={16} /> Import from Excel <span className="qa-arrow"><IconArrowRight size={15} /></span>
                </button>
              )}
              <button className="qa" onClick={exportExcel} disabled={!rows.length}>
                <IconDownload size={16} /> Export to Excel <span className="qa-arrow"><IconArrowRight size={15} /></span>
              </button>
              <button className="qa" onClick={() => navigate("/materials")}>
                <IconBox size={16} /> View All Particulars <span className="qa-arrow"><IconArrowRight size={15} /></span>
              </button>
              {me.data?.role === "owner" && (
                <button className="qa" onClick={() => navigate("/admin")}>
                  <IconUsers size={16} /> Manage Users <span className="qa-arrow"><IconArrowRight size={15} /></span>
                </button>
              )}
            </div>
          </div>
        </aside>
        )}
        {!railOpen && (
          <button className="rail-tab" title="Show stats panel" onClick={toggleRail}>
            <IconPanelRight size={15} />
          </button>
        )}
      </div>
    </>
  );
}
