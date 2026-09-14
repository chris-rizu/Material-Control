// Particulars — the item catalog. New particulars are added HERE (Brand +
// Particular), not from the Purchases dropdown. Input boxes live only in the
// add form; the table below is plain text. A particular with no brand shows
// an empty Brand cell. Click a row to see the typed variants (aliases) it
// remembers.

import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureMaterial, fetchAliases, fetchCategories, fetchMaterials } from "../lib/queries";
import { parseParticulars } from "../lib/parse";
import { guessCategory } from "../lib/guess";
import { IconBox, IconSearch } from "../components/icons";
import type { Material } from "../lib/types";

/** The particular without its brand: type + model + size, angle as " - 90°". */
function particularText(m: Material): string {
  let out = [m.type, m.model_ver, m.size_native]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const deg = Number(m.degrees ?? 0);
  if (deg > 0) out = out ? `${out} - ${deg}°` : `${deg}°`;
  if (!out) {
    const b = (m.brand ?? "").trim();
    out = b && m.search_name.startsWith(`${b} `) ? m.search_name.slice(b.length + 1) : m.search_name;
  }
  return out;
}

export default function MaterialsPage() {
  const qc = useQueryClient();
  const mats = useQuery({ queryKey: ["materials"], queryFn: fetchMaterials });
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const [filter, setFilter] = useState("");
  const [catFilter, setCatFilter] = useState<number | "">("");
  const [openId, setOpenId] = useState<number | null>(null);

  // add form
  const [brand, setBrand] = useState("");
  const [particular, setParticular] = useState("");
  const [addCat, setAddCat] = useState<number | "">("");
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const aliases = useQuery({
    queryKey: ["aliases", openId],
    queryFn: () => fetchAliases(openId!),
    enabled: openId !== null,
  });

  const add = useMutation({
    mutationFn: async () => {
      const text = particular.trim();
      if (!text) throw new Error("Type the particular.");
      const list = cats.data ?? [];
      if (!list.length) throw new Error("Categories are still loading — try again.");
      const b = brand.trim().toUpperCase().replace(/\s+/g, " ");

      const parsed = parseParticulars(text);
      if (b) {
        // the Brand box wins; a brand the parser found in the particular text
        // stays part of the description instead of being dropped
        if (parsed.brand && parsed.brand !== b) parsed.type = `${parsed.brand} ${parsed.type}`.trim();
        parsed.brand = b;
      }
      const cat = addCat === ""
        ? guessCategory(`${b} ${text}`, list)
        : list.find((c) => c.id === addCat) ?? guessCategory(text, list);

      const existed = new Set((mats.data ?? []).map((m) => m.id));
      const m = await ensureMaterial(cat.id, parsed, cat.unit);
      return { m, existed: existed.has(m.id), catName: cat.name };
    },
    onSuccess: ({ m, existed, catName }) => {
      setMsg(existed
        ? { kind: "warn", text: `Already in the list: ${m.search_name}` }
        : { kind: "ok", text: `Added: ${m.search_name} · ${catName}` });
      setBrand("");
      setParticular("");
      qc.invalidateQueries({ queryKey: ["materials"] });
      qc.invalidateQueries({ queryKey: ["material-search"] });
    },
    onError: (e: Error) => setMsg({ kind: "err", text: e.message }),
  });

  if (mats.isLoading || cats.isLoading) {
    return <div className="page-loading"><span className="spinner" /> Loading the catalog…</div>;
  }

  const rows = (mats.data ?? []).filter((m) => {
    if (catFilter !== "" && m.category_id !== catFilter) return false;
    const q = filter.toUpperCase();
    if (!q) return true;
    return (
      m.search_name.includes(q) ||
      (m.brand ?? "").toUpperCase().includes(q) ||
      (m.type ?? "").toUpperCase().includes(q) ||
      m.size_native.toUpperCase().includes(q)
    );
  });

  function submit() {
    setMsg(null);
    add.mutate();
  }

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <div className="page-icon"><IconBox size={22} /></div>
          <div>
            <h1>Particulars</h1>
            <div className="page-sub">
              Every item you buy. Add new particulars here — they show up as suggestions
              in Purchases. Click a row to see the spellings it remembers.
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <label className="field">
            Brand
            <input value={brand} placeholder="optional — e.g. MOLDEX"
              onChange={(e) => setBrand(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && particular.trim() && submit()} />
          </label>
          <label className="field grow">
            Particular
            <input value={particular} placeholder="e.g. PVC ELBOW 3X90"
              onChange={(e) => setParticular(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && particular.trim() && submit()} />
          </label>
          <label className="field">
            Category
            <select value={String(addCat)}
              onChange={(e) => setAddCat(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">Auto-detect</option>
              {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button className="primary" disabled={!particular.trim() || add.isPending} onClick={submit}>
            {add.isPending ? "Adding…" : "Add particular"}
          </button>
        </div>
        {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="field grow">
            Search
            <input value={filter} placeholder="MOLDEX, ELBOW, 10MM…"
              onChange={(e) => setFilter(e.target.value)} />
          </label>
          <label className="field">
            Category
            <select value={String(catFilter)}
              onChange={(e) => setCatFilter(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">All categories</option>
              {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>

        {rows.length === 0 ? (
          <div className="empty">
            <IconBox size={40} />
            <div className="e-title">No particulars match</div>
            <div>Add one above, or they appear automatically after you encode or import.</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: "18%" }}>Brand</th>
                <th><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><IconSearch size={13} /> Particular ({rows.length})</span></th>
                <th>Category</th>
                <th>Unit</th>
                <th className="num">Used</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const cat = (cats.data ?? []).find((c) => c.id === m.category_id);
                return (
                  <Fragment key={m.id}>
                    <tr onClick={() => setOpenId(openId === m.id ? null : m.id)}
                      style={{ cursor: "pointer" }}>
                      <td>{m.brand}</td>
                      <td><b>{particularText(m)}</b></td>
                      <td className="small">{cat?.name ?? "—"}</td>
                      <td>{m.unit}</td>
                      <td className="num">{m.usage_count}×</td>
                    </tr>
                    {openId === m.id && (
                      <tr>
                        <td colSpan={5} className="small">
                          <b>Spellings remembered:</b>{" "}
                          {(aliases.data ?? []).map((a) => (
                            <span key={a.id} className="chip">{a.alias_text} · {a.hit_count}×</span>
                          ))}
                          {aliases.data?.length === 0 && <span className="muted">none yet</span>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
