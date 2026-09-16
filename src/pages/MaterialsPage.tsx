// Particulars — the item catalog. New particulars are added HERE (Brand +
// Particular), not from the Purchases dropdown. Input boxes live only in the
// add form; the table below is plain text. A particular with no brand shows
// an empty Brand cell. Click a row to see the typed variants (aliases) it
// remembers. The Projects card below manages the project list that powers the
// Purchases entry row's predictive Project box.

import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addCategory, addProject, deleteCategory, deleteMaterial, deleteProject, deleteSupplier,
  ensureMaterial, ensureSupplier, fetchAliases, fetchCategories, fetchMaterials, fetchProjects,
  fetchPurchasesFlat, fetchSuppliers, renameProjectLines, updateCategory, updateMaterial,
  updateProjectName, updateSupplierName,
} from "../lib/queries";
import { parseParticulars } from "../lib/parse";
import { guessCategory } from "../lib/guess";
import {
  IconBox, IconCheck, IconPencil, IconPlus, IconSearch, IconTag, IconTrash, IconTruck, IconX,
} from "../components/icons";
import type { Material } from "../lib/types";

/** Short human text for the database errors the edit/delete actions hit. */
function friendly(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === "23503") return "Still in use — the things pointing at it must be moved first.";
  if (code === "23505") return "That name (or an identical copy) already exists.";
  return (e as Error)?.message ?? String(e);
}

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
  const projs = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
  const sups = useQuery({ queryKey: ["suppliers"], queryFn: fetchSuppliers });
  // shared ledger cache — powers the "used" counts in the Projects/Suppliers cards
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: fetchPurchasesFlat });
  const [filter, setFilter] = useState("");
  const [catFilter, setCatFilter] = useState<number | "">("");
  const [openId, setOpenId] = useState<number | null>(null);

  // add form
  const [brand, setBrand] = useState("");
  const [particular, setParticular] = useState("");
  const [addCat, setAddCat] = useState<number | "">("");
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  // projects card
  const [projName, setProjName] = useState("");
  const [projMsg, setProjMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [editProjId, setEditProjId] = useState<number | null>(null);
  const [editProjName, setEditProjName] = useState("");

  // categories card
  const [catName, setCatName] = useState("");
  const [catUnit, setCatUnit] = useState("pc");
  const [catMsg, setCatMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [editCatId, setEditCatId] = useState<number | null>(null);
  const [editCat, setEditCat] = useState({ name: "", unit: "pc" });

  // suppliers card
  const [supName, setSupName] = useState("");
  const [supMsg, setSupMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const [editSupId, setEditSupId] = useState<number | null>(null);
  const [editSupName, setEditSupName] = useState("");

  // particular (material) edit — expanded row under the table row
  const [editMatId, setEditMatId] = useState<number | null>(null);
  const [editMat, setEditMat] = useState({
    brand: "", type: "", model_ver: "", size_native: "",
    degrees: "0", unit: "pc", category_id: "" as number | "",
  });

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

  const addProj = useMutation({
    mutationFn: async () => {
      const name = projName.trim().replace(/\s+/g, " ");
      if (!name) throw new Error("Type the project name.");
      return addProject(name);
    },
    onSuccess: (p) => {
      setProjMsg({ kind: "ok", text: `Project added: ${p.name}` });
      setProjName("");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => setProjMsg({ kind: "err", text: e.message }),
  });

  const delProj = useMutation({
    mutationFn: (id: number) => deleteProject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
    onError: (e: Error) => setProjMsg({ kind: "err", text: e.message }),
  });

  const addCatM = useMutation({
    mutationFn: async () => {
      const name = catName.trim().replace(/\s+/g, " ");
      if (!name) throw new Error("Type the category name.");
      return addCategory(name, catUnit.trim() || "pc");
    },
    onSuccess: (c) => {
      setCatMsg({ kind: "ok", text: `Category added: ${c.name} (unit: ${c.unit})` });
      setCatName("");
      setCatUnit("pc");
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e: unknown) => setCatMsg({ kind: "err", text: friendly(e) }),
  });

  const saveCatM = useMutation({
    mutationFn: async () => {
      if (editCatId === null) throw new Error("Nothing to save.");
      const name = editCat.name.trim().replace(/\s+/g, " ");
      if (!name) throw new Error("Type the category name.");
      await updateCategory(editCatId, { name, unit: editCat.unit.trim() || "pc" });
    },
    onSuccess: () => {
      setEditCatId(null);
      setCatMsg({ kind: "ok", text: "Category updated." });
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e: unknown) => setCatMsg({ kind: "err", text: friendly(e) }),
  });

  const delCatM = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: () => {
      setCatMsg({ kind: "ok", text: "Category removed." });
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e: unknown) => setCatMsg({
      kind: "err",
      text: (e as { code?: string })?.code === "23503"
        ? "This category still has particulars — edit them into another category first."
        : friendly(e),
    }),
  });

  const renameProjM = useMutation({
    mutationFn: async () => {
      if (editProjId === null) throw new Error("Nothing to save.");
      const name = editProjName.trim().replace(/\s+/g, " ");
      if (!name) throw new Error("Type the project name.");
      const old = (projs.data ?? []).find((p) => p.id === editProjId)?.name ?? "";
      await updateProjectName(editProjId, name);
      if (old && old.toUpperCase() !== name.toUpperCase()) {
        // the ledger stores project names as free text — re-point those lines
        await renameProjectLines(old, name);
      }
    },
    onSuccess: () => {
      setEditProjId(null);
      setProjMsg({ kind: "ok", text: "Project renamed — its purchase lines were updated too." });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (e: unknown) => setProjMsg({ kind: "err", text: friendly(e) }),
  });

  const addSupM = useMutation({
    mutationFn: async () => {
      const name = supName.trim().replace(/\s+/g, " ");
      if (!name) throw new Error("Type the supplier name.");
      const existed = (sups.data ?? []).some((s) => s.name.toUpperCase() === name.toUpperCase());
      const s = await ensureSupplier(name);
      return { s, existed };
    },
    onSuccess: ({ s, existed }) => {
      setSupMsg(existed
        ? { kind: "warn", text: `Already in the list: ${s.name}` }
        : { kind: "ok", text: `Supplier added: ${s.name}` });
      setSupName("");
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e: unknown) => setSupMsg({ kind: "err", text: friendly(e) }),
  });

  const saveSupM = useMutation({
    mutationFn: async () => {
      if (editSupId === null) throw new Error("Nothing to save.");
      const name = editSupName.trim().replace(/\s+/g, " ");
      if (!name) throw new Error("Type the supplier name.");
      await updateSupplierName(editSupId, name);
    },
    onSuccess: () => {
      setEditSupId(null);
      setSupMsg({ kind: "ok", text: "Supplier renamed — purchase lines show the new name (they link by id)." });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (e: unknown) => setSupMsg({ kind: "err", text: friendly(e) }),
  });

  const delSupM = useMutation({
    mutationFn: (id: number) => deleteSupplier(id),
    onSuccess: () => {
      setSupMsg({ kind: "ok", text: "Supplier removed." });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (e: unknown) => setSupMsg({ kind: "err", text: friendly(e) }),
  });

  const saveMatM = useMutation({
    mutationFn: async () => {
      if (editMatId === null) throw new Error("Nothing to save.");
      if (editMat.category_id === "") throw new Error("Pick a category.");
      await updateMaterial(editMatId, {
        brand: editMat.brand.trim().toUpperCase(),
        type: editMat.type.trim().toUpperCase(),
        model_ver: editMat.model_ver.trim().toUpperCase(),
        size_native: editMat.size_native.trim().toUpperCase(),
        degrees: Number(editMat.degrees) || 0,
        unit: editMat.unit.trim() || "pc",
        category_id: Number(editMat.category_id),
      });
    },
    onSuccess: () => {
      setEditMatId(null);
      setMsg({ kind: "ok", text: "Particular updated." });
      qc.invalidateQueries({ queryKey: ["materials"] });
      qc.invalidateQueries({ queryKey: ["material-search"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (e: unknown) => setMsg({ kind: "err", text: friendly(e) }),
  });

  const delMatM = useMutation({
    mutationFn: (id: number) => deleteMaterial(id),
    onSuccess: () => {
      setMsg({ kind: "ok", text: "Particular removed from the catalog." });
      qc.invalidateQueries({ queryKey: ["materials"] });
      qc.invalidateQueries({ queryKey: ["material-search"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (e: unknown) => setMsg({ kind: "err", text: friendly(e) }),
  });

  function startMatEdit(m: Material) {
    setEditMatId(m.id);
    setEditMat({
      brand: m.brand ?? "",
      type: m.type ?? "",
      model_ver: m.model_ver ?? "",
      size_native: m.size_native ?? "",
      degrees: String(m.degrees ?? 0),
      unit: m.unit ?? "pc",
      category_id: m.category_id,
    });
  }

  // usage counts from the ledger (case-insensitive on the trimmed project name)
  const used = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const r of ledger.data ?? []) {
      const p = (r.project_name ?? "").trim();
      if (!p) continue;
      const k = p.toUpperCase();
      const cur = m.get(k);
      if (cur) cur.n += 1;
      else m.set(k, { name: p, n: 1 });
    }
    return m;
  }, [ledger.data]);

  // how many ledger lines each supplier is on (purchases link by id; the flat
  // view carries the joined name)
  const supUsed = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ledger.data ?? []) {
      const s = (r.supplier ?? "").trim();
      if (!s) continue;
      const k = s.toUpperCase();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [ledger.data]);

  // catalog rows first, then ledger-only names not catalogued yet (they join
  // the catalog automatically the next time a purchase uses them)
  const projRows = useMemo(() => {
    const cat = projs.data ?? [];
    const out: { id: number | null; name: string; used: number }[] = cat.map((p) => ({
      id: p.id,
      name: p.name,
      used: used.get(p.name_norm ?? p.name.toUpperCase())?.n ?? 0,
    }));
    const have = new Set(cat.map((p) => p.name_norm ?? p.name.toUpperCase()));
    for (const [k, v] of used) {
      if (!have.has(k)) out.push({ id: null, name: v.name, used: v.n });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [projs.data, used]);

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
        <div className="card-head"><IconTag size={16} /> Projects</div>
        <div className="muted small" style={{ marginTop: 4 }}>
          The jobs purchases belong to (MCDO, Talisay…). They power the Project box on
          the Purchases entry row — typing a new project there adds it here automatically.
        </div>
        {projs.isError && (
          <div className="banner warn" style={{ marginTop: 10 }}>
            The projects catalog isn’t in the database yet — run <b>supabase/migration_004_projects.sql</b> in
            the Supabase SQL Editor (same steps as migration_003). The list below still shows the projects your
            ledger already uses.
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <label className="field grow">
            Project
            <input value={projName} placeholder="e.g. MCDO"
              onChange={(e) => setProjName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && projName.trim() && addProj.mutate()} />
          </label>
          <button className="primary" disabled={!projName.trim() || addProj.isPending || projs.isError}
            onClick={() => { setProjMsg(null); addProj.mutate(); }}>
            {addProj.isPending ? "Adding…" : "Add project"}
          </button>
        </div>
        {projMsg && <div className={`banner ${projMsg.kind}`}>{projMsg.text}</div>}
        {projRows.length === 0 ? (
          <div className="muted small" style={{ padding: "10px 0 2px" }}>
            No projects yet — add one above, or type one on the Purchases entry row.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Project ({projRows.length})</th>
                <th className="num">Used</th>
                {!projs.isError && <th style={{ width: 88 }} />}
              </tr>
            </thead>
            <tbody>
              {projRows.map((p) => {
                const editing = p.id !== null && editProjId === p.id;
                return (
                  <tr key={p.name}>
                    <td>
                      {editing ? (
                        <input value={editProjName} autoFocus style={{ width: "100%" }}
                          onChange={(e) => setEditProjName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") renameProjM.mutate();
                            if (e.key === "Escape") setEditProjId(null);
                          }} />
                      ) : (
                        <>
                          <b>{p.name}</b>
                          {p.id === null && (
                            <span className="chip" style={{ marginLeft: 8 }} title="Not in the catalog yet — it joins automatically when a purchase uses it">in ledger</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="num">{p.used}×</td>
                    {!projs.isError && (
                      <td className="actions">
                        {editing ? (
                          <>
                            <button className="iconbtn" title="Save"
                              onClick={() => renameProjM.mutate()}>
                              <IconCheck size={15} />
                            </button>
                            <button className="iconbtn" title="Cancel"
                              onClick={() => setEditProjId(null)}>
                              <IconX size={15} />
                            </button>
                          </>
                        ) : p.id !== null && (
                          <>
                            <button className="iconbtn" title="Rename project"
                              onClick={() => { setEditProjId(p.id); setEditProjName(p.name); }}>
                              <IconPencil size={15} />
                            </button>
                            <button className="iconbtn" title="Remove from the project list"
                              onClick={() => {
                                if (confirm(`Remove “${p.name}” from the project list? Existing purchase lines keep their project name.`)) {
                                  delProj.mutate(p.id!); // guarded by p.id !== null above
                                }
                              }}>
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
        )}
      </div>

      <div className="card">
        <div className="card-head"><IconPlus size={16} /> Categories</div>
        <div className="muted small" style={{ marginTop: 4 }}>
          The buckets purchases are sorted into. Imports and the Purchases entry row add a
          missing category automatically — you can add one here yourself too.
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="field grow">
            Category
            <input value={catName} placeholder="e.g. Painting Supplies"
              onChange={(e) => setCatName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && catName.trim() && addCatM.mutate()} />
          </label>
          <label className="field">
            Unit
            <input value={catUnit} list="unit-options" style={{ width: 90 }}
              onChange={(e) => setCatUnit(e.target.value)} />
            <datalist id="unit-options">
              {["pc", "bag", "L", "kg", "m", "box", "set", "pair"].map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </label>
          <button className="primary" disabled={!catName.trim() || addCatM.isPending}
            onClick={() => { setCatMsg(null); addCatM.mutate(); }}>
            {addCatM.isPending ? "Adding…" : "Add category"}
          </button>
        </div>
        {catMsg && <div className={`banner ${catMsg.kind}`}>{catMsg.text}</div>}
        <table>
          <thead>
            <tr>
              <th>Category ({(cats.data ?? []).length})</th>
              <th>Unit</th>
              <th className="num">Particulars</th>
              <th style={{ width: 88 }} />
            </tr>
          </thead>
          <tbody>
            {(cats.data ?? []).map((c) => {
              const editing = editCatId === c.id;
              return (
                <tr key={c.id}>
                  <td>
                    {editing ? (
                      <input value={editCat.name} autoFocus style={{ width: "100%" }}
                        onChange={(e) => setEditCat({ ...editCat, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveCatM.mutate();
                          if (e.key === "Escape") setEditCatId(null);
                        }} />
                    ) : (
                      <b>{c.name}</b>
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <input value={editCat.unit} style={{ width: 70 }}
                        onChange={(e) => setEditCat({ ...editCat, unit: e.target.value })} />
                    ) : (
                      c.unit
                    )}
                  </td>
                  <td className="num">{(mats.data ?? []).filter((m) => m.category_id === c.id).length}×</td>
                  <td className="actions">
                    {editing ? (
                      <>
                        <button className="iconbtn" title="Save" onClick={() => saveCatM.mutate()}>
                          <IconCheck size={15} />
                        </button>
                        <button className="iconbtn" title="Cancel" onClick={() => setEditCatId(null)}>
                          <IconX size={15} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="iconbtn" title="Rename category"
                          onClick={() => { setEditCatId(c.id); setEditCat({ name: c.name, unit: c.unit }); }}>
                          <IconPencil size={15} />
                        </button>
                        <button className="iconbtn" title="Remove category"
                          onClick={() => {
                            if (confirm(`Remove the category “${c.name}”? A category with particulars in it cannot be removed.`)) {
                              delCatM.mutate(c.id);
                            }
                          }}>
                          <IconTrash size={15} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head"><IconTruck size={16} /> Suppliers</div>
        <div className="muted small" style={{ marginTop: 4 }}>
          The companies you buy from. A new name typed on a purchase or an import joins
          this list automatically.
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="field grow">
            Supplier
            <input value={supName} placeholder="e.g. SUNTRADE"
              onChange={(e) => setSupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && supName.trim() && addSupM.mutate()} />
          </label>
          <button className="primary" disabled={!supName.trim() || addSupM.isPending}
            onClick={() => { setSupMsg(null); addSupM.mutate(); }}>
            {addSupM.isPending ? "Adding…" : "Add supplier"}
          </button>
        </div>
        {supMsg && <div className={`banner ${supMsg.kind}`}>{supMsg.text}</div>}
        <table>
          <thead>
            <tr>
              <th>Supplier ({(sups.data ?? []).length})</th>
              <th className="num">Used</th>
              <th style={{ width: 88 }} />
            </tr>
          </thead>
          <tbody>
            {(sups.data ?? []).map((s) => {
              const editing = editSupId === s.id;
              const n = supUsed.get(s.name.toUpperCase()) ?? 0;
              return (
                <tr key={s.id}>
                  <td>
                    {editing ? (
                      <input value={editSupName} autoFocus style={{ width: "100%" }}
                        onChange={(e) => setEditSupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveSupM.mutate();
                          if (e.key === "Escape") setEditSupId(null);
                        }} />
                    ) : (
                      <b>{s.name}</b>
                    )}
                  </td>
                  <td className="num">{n}×</td>
                  <td className="actions">
                    {editing ? (
                      <>
                        <button className="iconbtn" title="Save" onClick={() => saveSupM.mutate()}>
                          <IconCheck size={15} />
                        </button>
                        <button className="iconbtn" title="Cancel" onClick={() => setEditSupId(null)}>
                          <IconX size={15} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="iconbtn" title="Rename supplier"
                          onClick={() => { setEditSupId(s.id); setEditSupName(s.name); }}>
                          <IconPencil size={15} />
                        </button>
                        <button className="iconbtn" title="Remove supplier"
                          onClick={() => {
                            const q = n > 0
                              ? `Delete “${s.name}”? Its ${n} purchase lines keep their amounts but lose the supplier name.`
                              : `Delete “${s.name}” from the supplier list?`;
                            if (confirm(q)) delSupM.mutate(s.id);
                          }}>
                          <IconTrash size={15} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
                <th style={{ width: 88 }} />
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
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
                        <button className="iconbtn" title="Edit particular"
                          onClick={() => (editMatId === m.id ? setEditMatId(null) : startMatEdit(m))}>
                          <IconPencil size={15} />
                        </button>
                        <button className="iconbtn" title="Remove particular"
                          onClick={() => {
                            const q = m.usage_count > 0
                              ? `Remove “${particularText(m)}” from the catalog? Its ${m.usage_count} purchase lines keep their typed text but lose the link.`
                              : `Remove “${particularText(m)}” from the catalog?`;
                            if (confirm(q)) delMatM.mutate(m.id);
                          }}>
                          <IconTrash size={15} />
                        </button>
                      </td>
                    </tr>
                    {editMatId === m.id && (
                      <tr>
                        <td colSpan={6}>
                          <div className="row" style={{ alignItems: "flex-end", gap: 10 }}>
                            <label className="field">
                              Brand
                              <input value={editMat.brand} style={{ width: 110 }}
                                onChange={(e) => setEditMat({ ...editMat, brand: e.target.value })} />
                            </label>
                            <label className="field grow">
                              Type
                              <input value={editMat.type}
                                onChange={(e) => setEditMat({ ...editMat, type: e.target.value })} />
                            </label>
                            <label className="field">
                              Model / Version
                              <input value={editMat.model_ver} style={{ width: 100 }}
                                onChange={(e) => setEditMat({ ...editMat, model_ver: e.target.value })} />
                            </label>
                            <label className="field">
                              Size
                              <input value={editMat.size_native} style={{ width: 90 }}
                                onChange={(e) => setEditMat({ ...editMat, size_native: e.target.value })} />
                            </label>
                            <label className="field">
                              Degrees
                              <input type="number" step="any" min={0} max={360} value={editMat.degrees}
                                style={{ width: 80 }}
                                onChange={(e) => setEditMat({ ...editMat, degrees: e.target.value })} />
                            </label>
                            <label className="field">
                              Unit
                              <input value={editMat.unit} list="unit-options" style={{ width: 70 }}
                                onChange={(e) => setEditMat({ ...editMat, unit: e.target.value })} />
                            </label>
                            <label className="field">
                              Category
                              <select value={String(editMat.category_id)}
                                onChange={(e) => setEditMat({ ...editMat, category_id: e.target.value === "" ? "" : Number(e.target.value) })}>
                                {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            </label>
                            <button className="primary" disabled={saveMatM.isPending}
                              onClick={() => saveMatM.mutate()}>
                              {saveMatM.isPending ? "Saving…" : "Save"}
                            </button>
                            <button onClick={() => setEditMatId(null)}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {openId === m.id && (
                      <tr>
                        <td colSpan={6} className="small">
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
