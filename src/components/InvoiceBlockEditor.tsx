import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import PredictiveMaterialInput from "./PredictiveMaterialInput";
import CategoryForm from "./CategoryForm";
import { ensureSupplier, saveInvoiceBlock } from "../lib/queries";
import { parseParticulars } from "../lib/parse";
import { php } from "../lib/format";
import { IconInvoice, IconBox, IconPlus, IconX, IconCoins } from "./icons";
import type {
  AttributeField, Category, InvoiceBlock, LineItem, SearchHit, Supplier,
} from "../lib/types";

interface Props {
  categories: Category[];
  suppliers: Supplier[];
  userId: string;
}

function emptyLine(): LineItem {
  return {
    clientKey: Math.random().toString(36).slice(2),
    category_id: null,
    material_id: null,
    particulars_raw: "",
    attributes: {},
    unit_price: "",
    quantity: "",
  };
}

/**
 * One invoice block editor: date + SI# + supplier + N line items with a
 * running subtotal. Saving writes all lines atomically; the DB trigger then
 * records aliases (the predictive memory) and usage counters.
 */
export default function InvoiceBlockEditor({ categories, suppliers, userId }: Props) {
  const qc = useQueryClient();
  const [block, setBlock] = useState<InvoiceBlock>(() => ({
    purchase_date: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date()),
    si_no: "",
    supplier_id: null,
    project_name: "",
    lines: [emptyLine()],
  }));
  const [supplierText, setSupplierText] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const subtotal = block.lines.reduce((s, l) => {
    const p = l.unit_price === "" ? 0 : l.unit_price;
    const q = l.quantity === "" ? 0 : l.quantity;
    return s + Math.round(p * q * 100) / 100;
  }, 0);

  const save = useMutation({
    mutationFn: async () => {
      const supplier = await ensureSupplier(supplierText);
      return saveInvoiceBlock({ ...block, supplier_id: supplier.id }, userId);
    },
    onSuccess: (n) => {
      setMessage({ kind: "ok", text: `Saved ${n} line${n > 1 ? "s" : ""} · subtotal ₱${php(subtotal)}` });
      setBlock((b) => ({ ...b, si_no: "", project_name: "", lines: [emptyLine()] }));
      setSupplierText("");
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["materials"] });
    },
    onError: (e: Error) => setMessage({ kind: "err", text: e.message }),
  });

  function patchLine(key: string, patch: Partial<LineItem>) {
    setBlock((b) => ({
      ...b,
      lines: b.lines.map((l) => (l.clientKey === key ? { ...l, ...patch } : l)),
    }));
  }

  function onCategory(key: string, catId: number | null) {
    const cat = categories.find((c) => c.id === catId);
    patchLine(key, { category_id: catId, attributes: cat ? templateDefaults(cat.attribute_template) : {} });
  }

  /** Apply a picked suggestion: category, attributes, price prefill. */
  function onPick(key: string, hit: SearchHit | null) {
    const line = block.lines.find((l) => l.clientKey === key);
    if (!line) return;
    if (hit) {
      const cat = categories.find((c) => c.id === hit.category_id);
      patchLine(key, {
        material_id: hit.id,
        category_id: hit.category_id,
        attributes: {
          brand: hit.brand, type: hit.type, model_ver: hit.model_ver,
          size_native: hit.size_native, size_system: hit.size_system,
          diameter: hit.diameter, degrees: hit.degrees || "",
          ...(cat ? templateDefaults(cat.attribute_template) : {}),
        },
        unit_price: line.unit_price === "" && hit.last_unit_price != null
          ? Number(hit.last_unit_price)
          : line.unit_price,
      });
    } else {
      // "Create new": prefill attributes from the parser.
      const parsed = parseParticulars(line.particulars_raw);
      patchLine(key, {
        material_id: null,
        attributes: {
          brand: parsed.brand, type: parsed.type,
          size_native: parsed.size_native, size_system: parsed.size_system,
          degrees: parsed.degrees || "",
        },
      });
    }
  }

  return (
    <>
      <div className="card">
        <h2><IconInvoice size={17} /> Invoice details</h2>
        <div className="row">
          <label className="field">
            Date
            <input type="date" value={block.purchase_date}
              onChange={(e) => setBlock((b) => ({ ...b, purchase_date: e.target.value }))} />
          </label>
          <label className="field grow">
            SI # / Receipt
            <input value={block.si_no} placeholder="SI# 292713 — or N/A"
              onChange={(e) => setBlock((b) => ({ ...b, si_no: e.target.value }))} />
          </label>
          <label className="field grow">
            Supplier
            <input list="supplier-list" value={supplierText}
              placeholder="type or pick — new names are created automatically"
              onChange={(e) => setSupplierText(e.target.value)} />
            <datalist id="supplier-list">
              {suppliers.map((s) => <option key={s.id} value={s.name} />)}
            </datalist>
          </label>
          <label className="field">
            Project name
            <input value={block.project_name} placeholder="e.g. Mcdo, Talisay"
              onChange={(e) => setBlock((b) => ({ ...b, project_name: e.target.value }))} />
          </label>
        </div>
      </div>

      <div className="card">
        <h2><IconBox size={17} /> Line items</h2>
        {block.lines.map((line, idx) => {
          const cat = categories.find((c) => c.id === line.category_id);
          const amount =
            (line.unit_price === "" ? 0 : line.unit_price) *
            (line.quantity === "" ? 0 : line.quantity);
          return (
            <div className="line-box" key={line.clientKey}>
              <div className="row" style={{ alignItems: "center", marginBottom: 8 }}>
                <span className="line-num">{idx + 1}</span>
                <span className="spacer" />
                <button className="icon danger" title="Remove line"
                  disabled={block.lines.length === 1}
                  onClick={() => setBlock((b) => ({
                    ...b, lines: b.lines.filter((l) => l.clientKey !== line.clientKey),
                  }))}>
                  <IconX size={14} />
                </button>
              </div>
              <div className="line-grid">
                <label className="field" style={{ minWidth: 170 }}>
                  Category
                  <select value={line.category_id ?? ""}
                    onChange={(e) => onCategory(line.clientKey, e.target.value ? Number(e.target.value) : null)}>
                    <option value="">— pick category —</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <div className="field" style={{ flex: 2, minWidth: 220 }}>
                  <label className="field" style={{ display: "block" }}>Particulars — type to search your history</label>
                  <div style={{ marginTop: 5 }}>
                    <PredictiveMaterialInput
                      value={line.particulars_raw}
                      onChange={(t) => patchLine(line.clientKey, { particulars_raw: t })}
                      onPick={(hit) => onPick(line.clientKey, hit)}
                      categoryId={line.category_id}
                    />
                  </div>
                </div>
                <label className="field">
                  Unit price
                  <input className="mono" type="number" step="0.01" min="0" placeholder="0.00"
                    value={line.unit_price}
                    onChange={(e) => patchLine(line.clientKey, {
                      unit_price: e.target.value === "" ? "" : Number(e.target.value),
                    })} />
                </label>
                <label className="field">
                  Quantity
                  <input className="mono" type="number" step="0.001" min="0" placeholder="1"
                    value={line.quantity}
                    onChange={(e) => patchLine(line.clientKey, {
                      quantity: e.target.value === "" ? "" : Number(e.target.value),
                    })} />
                </label>
                <div className="field">
                  Amount
                  <div className="amount-preview" style={{ marginTop: 7 }}>{php(Math.round(amount * 100) / 100)}</div>
                </div>
              </div>
              {cat && (
                <div style={{ marginTop: 10 }}>
                  <CategoryForm
                    template={cat.attribute_template}
                    values={line.attributes}
                    onChange={(vals) => patchLine(line.clientKey, { attributes: vals })}
                  />
                </div>
              )}
            </div>
          );
        })}

        <button className="ghost" onClick={() => setBlock((b) => ({ ...b, lines: [...b.lines, emptyLine()] }))}>
          <IconPlus size={16} /> Add another line
        </button>
      </div>

      <div className="savebar">
        <button onClick={() => setBlock((b) => ({ ...b, lines: [...b.lines, emptyLine()] }))}>
          <IconPlus size={16} /> Add line
        </button>
        <span className="spacer" />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }} className="muted small">
          <IconCoins size={16} /> Subtotal
        </span>
        <span className="amount-preview" style={{ fontSize: 18 }}>₱{php(subtotal)}</span>
        <button className="primary"
          disabled={save.isPending}
          onClick={() => {
            setMessage(null);
            const bad = block.lines.find(
              (l) => !l.particulars_raw.trim() || l.unit_price === "" || l.quantity === "",
            );
            if (!block.purchase_date) { setMessage({ kind: "err", text: "Date is required." }); return; }
            if (!supplierText.trim()) { setMessage({ kind: "err", text: "Supplier is required." }); return; }
            if (bad) { setMessage({ kind: "err", text: "Every line needs particulars, unit price and quantity." }); return; }
            save.mutate();
          }}>
          {save.isPending ? <span className="spinner" style={{ borderTopColor: "#fff" }} /> : null}
          {save.isPending ? "Saving…" : "Save invoice"}
        </button>
      </div>
      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}
    </>
  );
}

function templateDefaults(template: AttributeField[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of template) {
    if (f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}
