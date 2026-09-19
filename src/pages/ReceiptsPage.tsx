// Receipts — one photo per sales invoice. A photo is keyed to the same
// invoice block the ledger uses (date + SI# + supplier), so it opens from
// the ledger by clicking the SI# on any matching line (blank-SI "same
// receipt as above" blocks file one photo keyed to date + supplier).
// Photos are downscaled to a max-1600px JPEG before upload and live in a
// PRIVATE storage bucket; thumbnails and the viewer share the receipt photo
// cache (lib/receiptPhotos), so a photo is downloaded once and kept.

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { deleteReceipt, fetchReceipts, fetchSuppliers, refileReceipt, uploadReceipt } from "../lib/queries";
import { loadReceiptPhoto, peekReceiptPhoto, preloadReceiptPhotos } from "../lib/receiptPhotos";
import { siDigits, toSiNo, todayISO } from "../lib/format";
import SiInput from "../components/SiInput";
import ReceiptViewer from "../components/ReceiptViewer";
import { IconReceipt, IconTrash, IconUpload } from "../components/icons";
import type { Receipt } from "../lib/types";

/** List thumbnail — paints instantly when the photo is already cached. */
function ReceiptThumb({ r, onOpen }: { r: Receipt; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(() => peekReceiptPhoto(r.storage_path));
  useEffect(() => {
    let alive = true;
    loadReceiptPhoto(r.storage_path).then((u) => { if (alive) setUrl(u); }, () => {});
    return () => { alive = false; };
  }, [r.storage_path]);
  return url
    ? <img className="rc-thumb-sm" src={url} title="View receipt"
        alt={`Receipt ${r.si_no || r.purchase_date}`} onClick={onOpen} />
    : <span className="spinner" />;
}

function fileSizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function ReceiptsPage() {
  const qc = useQueryClient();
  // "Add receipt" jumps from the ledger prefill the upload form via router state
  const pre = (useLocation().state ?? {}) as Partial<{
    purchase_date: string;
    si_no: string;
    supplier_id: number | null;
  }>;

  const receiptsQ = useQuery({ queryKey: ["receipts"], queryFn: fetchReceipts });
  const supsQ = useQuery({ queryKey: ["suppliers"], queryFn: fetchSuppliers });
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

  const [date, setDate] = useState(() => pre.purchase_date || todayISO());
  const [si, setSi] = useState(() => siDigits(pre.si_no ?? ""));
  const [supId, setSupId] = useState<number | "">(() => pre.supplier_id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [viewing, setViewing] = useState<Receipt | null>(null);

  const receipts = receiptsQ.data ?? [];
  const supName = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of supsQ.data ?? []) m.set(s.id, s.name);
    return m;
  }, [supsQ.data]);

  // warm the photo cache for the whole list (thumbnails + instant viewer)
  useEffect(() => {
    if (receipts.length) preloadReceiptPhotos(receipts.map((r) => r.storage_path));
  }, [receipts]);

  function pickFile(f: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : "");
    setMsg(null);
  }

  const addM = useMutation({
    mutationFn: () => {
      if (!date) throw new Error("Pick the invoice date first.");
      if (supId === "") throw new Error("Pick the supplier — the photo is filed under date + SI# + supplier.");
      if (!file) throw new Error("Choose a photo first.");
      return uploadReceipt({ purchaseDate: date, siNo: toSiNo(si), supplierId: Number(supId), file });
    },
    onSuccess: ({ replaced }) => {
      pickFile(null);
      setMsg({
        kind: "ok",
        text: (replaced ? "Replaced the previous photo for " : "Receipt photo added for ")
          + `${date}${toSiNo(si) ? ` · ${toSiNo(si)}` : ""} — it opens from the ledger: click the SI# (or —) on any matching line.`,
      });
      qc.invalidateQueries({ queryKey: ["receipts"] });
    },
    onError: (e: Error) => setMsg({ kind: "err", text: e.message }),
  });

  const delM = useMutation({
    mutationFn: (r: Receipt) => deleteReceipt(r),
    onSuccess: () => {
      setMsg({ kind: "ok", text: "Receipt photo deleted. The purchase lines are untouched." });
      qc.invalidateQueries({ queryKey: ["receipts"] });
    },
    onError: (e: Error) => setMsg({ kind: "err", text: e.message }),
  });

  // ---- row re-filing: correct a filed photo's date / SI# / supplier in place
  // (a mistyped SI# never needs delete + re-upload) --------------------------
  const [editId, setEditId] = useState<number | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editSi, setEditSi] = useState("");
  const [editSup, setEditSup] = useState<number | "">("");

  function startEdit(r: Receipt) {
    setMsg(null);
    setEditId(r.id);
    setEditDate(r.purchase_date);
    setEditSi(siDigits(r.si_no)); // the box shows digits; the save re-wraps "SI# …"
    setEditSup(r.supplier_id ?? "");
  }

  function cancelEdit() {
    setEditId(null);
  }

  const refileM = useMutation({
    mutationFn: (r: Receipt) => {
      if (!editDate) return Promise.reject(new Error("Pick the invoice date first."));
      if (editSup === "") {
        return Promise.reject(
          new Error("Pick the supplier — the photo is filed under date + SI# + supplier."),
        );
      }
      return refileReceipt(r, {
        purchaseDate: editDate, siNo: toSiNo(editSi), supplierId: Number(editSup),
      });
    },
    onSuccess: () => {
      setEditId(null);
      setMsg({
        kind: "ok",
        text: `Receipt re-filed under ${editDate}${toSiNo(editSi) ? ` · ${toSiNo(editSi)}` : ""}`
          + " — it now opens from the ledger by that SI#.",
      });
      qc.invalidateQueries({ queryKey: ["receipts"] });
    },
    onError: (e: Error) => setMsg({ kind: "err", text: e.message }),
  });

  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <div className="page-icon"><IconReceipt size={22} /></div>
          <div>
            <h1>Receipts</h1>
            <div className="page-sub">Photos of your sales invoices — add one per receipt, then open it from the ledger by clicking the SI#. A wrong date, SI# or supplier is fixed with Edit — no need to delete and re-upload.</div>
          </div>
        </div>
      </div>

      {receiptsQ.isError && (
        <div className="banner warn">
          Receipts aren't in the database yet — run <b>supabase/migration_005_receipts.sql</b> in the
          Supabase SQL Editor (same steps as migration_004). This tab finishes wiring up as soon as that's run.
        </div>
      )}

      {canWrite && (
        <div className="card">
          <div className="card-head"><IconUpload size={16} /> Add a receipt photo</div>
          <div className="rc-form">
            <label className="rc-field">
              <span className="rc-lbl">Invoice date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="rc-field">
              <span className="rc-lbl">SI# <span className="muted small">(leave blank for the "same receipt" blocks)</span></span>
              <SiInput value={si} onChange={setSi} />
            </label>
            <label className="rc-field">
              <span className="rc-lbl">Supplier</span>
              <select value={String(supId)}
                onChange={(e) => setSupId(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">Pick supplier…</option>
                {(supsQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <div className="rc-field">
              <span className="rc-lbl">Photo <span className="muted small">(phone photos are auto-shrunk)</span></span>
              <div className="rc-file">
                {preview && <img className="rc-thumb" src={preview} alt="Selected receipt" />}
                <label className="rc-choose">
                  <input type="file" accept="image/*"
                    onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
                  {file ? "Change photo…" : "Choose photo…"}
                </label>
                {file && <span className="muted small">{file.name}</span>}
              </div>
            </div>
            <button className="primary" disabled={addM.isPending} onClick={() => addM.mutate()}>
              {addM.isPending ? <span className="spinner" style={{ borderTopColor: "#fff" }} /> : "Add receipt"}
            </button>
          </div>
          <div className="muted small" style={{ marginTop: 10 }}>
            The photo is filed under date + SI# + supplier — exactly how the ledger groups lines,
            so one photo covers every line of the same receipt.
          </div>
        </div>
      )}

      {msg && <div className={`banner ${msg.kind}`}>{msg.text}</div>}

      <div className="card">
        <div className="card-head"><IconReceipt size={16} /> Filed receipts {receipts.length > 0 && `(${receipts.length})`}</div>
        {receipts.length === 0 ? (
          <div className="empty">
            <IconReceipt size={40} />
            <div className="e-title">No receipt photos yet</div>
            <div>{canWrite
              ? "Add the first photo above — then click the SI# in the ledger to view it."
              : "Receipt photos will appear here once the team adds them."}</div>
          </div>
        ) : (
          <div className="rc-scroll">
            <table className="rc-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Photo</th>
                  <th style={{ width: "13%" }}>Date</th>
                  <th style={{ width: "14%" }}>SI#</th>
                  <th style={{ width: "30%" }}>Supplier</th>
                  <th style={{ width: "11%" }}>Size</th>
                  <th style={{ width: "16%" }}>Added</th>
                  <th style={{ width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => {
                  const editing = editId === r.id;
                  return (
                    <tr key={r.id}>
                      <td>
                        <ReceiptThumb r={r} onOpen={() => setViewing(r)} />
                      </td>
                      <td>{editing
                        ? <input type="date" value={editDate}
                            onChange={(e) => setEditDate(e.target.value)} />
                        : r.purchase_date}</td>
                      <td>{editing
                        ? <SiInput value={editSi} onChange={setEditSi} />
                        : (r.si_no || <span className="muted">—</span>)}</td>
                      <td title={editing || r.supplier_id == null ? undefined : supName.get(r.supplier_id)}>
                        {editing
                          ? <select value={String(editSup)}
                              onChange={(e) => setEditSup(e.target.value === "" ? "" : Number(e.target.value))}>
                              <option value="">Pick supplier…</option>
                              {(supsQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          : r.supplier_id != null ? supName.get(r.supplier_id) ?? "—"
                            : <span className="muted">—</span>}
                      </td>
                      <td className="muted">{fileSizeText(Number(r.file_size))}</td>
                      <td className="muted">{new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</td>
                      <td className="actions">
                        {editing ? (
                          <>
                            <button className="iconbtn" title="Save re-filing" disabled={refileM.isPending}
                              onClick={() => refileM.mutate(r)}>
                              {refileM.isPending ? <span className="spinner" /> : "Save"}
                            </button>
                            <button className="iconbtn" title="Cancel re-filing"
                              onClick={cancelEdit}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="iconbtn" title="View receipt" onClick={() => setViewing(r)}>View</button>
                            {canWrite && (
                              <>
                                <button className="iconbtn" title="Edit receipt filing"
                                  onClick={() => startEdit(r)}>Edit</button>
                                <button className="iconbtn" title="Delete receipt photo"
                                  onClick={() => {
                                    if (confirm(`Delete this receipt photo?\n\n${r.purchase_date} · ${r.si_no || "no SI#"}\n\nThe purchase lines stay — only the photo is removed.\n(Just a wrong SI#, date or supplier? Use Edit instead.)`)) {
                                      delM.mutate(r);
                                    }
                                  }}>
                                  <IconTrash size={15} />
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ReceiptViewer receipt={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
