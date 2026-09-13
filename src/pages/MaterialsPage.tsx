import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAliases, fetchCategories, fetchMaterials } from "../lib/queries";
import { IconBox, IconSearch } from "../components/icons";

/** Catalog browser: the structured materials, their attributes and alias memory. */
export default function MaterialsPage() {
  const mats = useQuery({ queryKey: ["materials"], queryFn: fetchMaterials });
  const cats = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const [filter, setFilter] = useState("");
  const [catFilter, setCatFilter] = useState<number | "">("");
  const [openId, setOpenId] = useState<number | null>(null);

  const aliases = useQuery({
    queryKey: ["aliases", openId],
    queryFn: () => fetchAliases(openId!),
    enabled: openId !== null,
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Materials</h1>
          <div className="page-sub">
            The structured catalog — grows automatically from every entry and import.
            Click a row to see the typed variants (aliases) it remembers.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row">
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
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">
            <IconBox size={40} />
            <div className="e-title">No materials match</div>
            <div>
              Materials appear here after you encode or import —
              the entry screen creates them with full structure.
            </div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><IconSearch size={13} /> Material ({rows.length})</span></th>
                <th>Category</th><th>Brand</th><th>Type</th>
                <th>Size</th><th className="num">Degrees</th><th>System</th>
                <th>Unit</th><th className="num">Used</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const cat = (cats.data ?? []).find((c) => c.id === m.category_id);
                return (
                  <Fragment key={m.id}>
                    <tr onClick={() => setOpenId(openId === m.id ? null : m.id)}
                      style={{ cursor: "pointer" }}>
                      <td><b>{m.search_name}</b></td>
                      <td className="small">{cat?.name ?? "—"}</td>
                      <td>{m.brand || "—"}</td>
                      <td>{m.type || "—"}</td>
                      <td>{m.size_native || "—"}</td>
                      <td className="num">{m.degrees ? `${m.degrees}°` : "—"}</td>
                      <td className="small">{m.size_system}</td>
                      <td>{m.unit}</td>
                      <td className="num">{m.usage_count}×</td>
                    </tr>
                    {openId === m.id && (
                      <tr>
                        <td colSpan={9} className="small">
                          <b>Aliases remembered:</b>{" "}
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
