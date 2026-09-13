// Predictive supplier input: suggests existing suppliers while typing and
// offers a deliberate "add new" path — so a typo shows "did you mean?"
// instead of silently creating a bogus supplier.

import { useEffect, useRef, useState } from "react";
import { matchSuppliers } from "../lib/supplierMatch";
import type { Supplier } from "../lib/types";

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Full supplier list (already loaded by the page). */
  suppliers: Supplier[];
  /** Called when the user deliberately chooses "add as new supplier". */
  onPickNew?: () => void;
  placeholder?: string;
  /** Extra key-down hook (Enter on the row). Only fires when the dropdown
   *  is not offering a suggestion to accept. */
  onEnter?: () => void;
}

type Opt = { kind: "supplier"; supplier: Supplier } | { kind: "new" };

export default function SupplierInput({
  value, onChange, suppliers, onPickNew, placeholder, onEnter,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const q = value.trim();
  const { exact, candidates } = matchSuppliers(q, suppliers);

  let options: Opt[];
  if (q.length === 0) {
    // nothing typed — show the known suppliers to pick from
    options = suppliers.slice(0, 8).map((s) => ({ kind: "supplier", supplier: s }));
  } else {
    options = [];
    if (exact) options.push({ kind: "supplier", supplier: exact });
    for (const c of candidates) {
      if (exact && c.id === exact.id) continue;
      options.push({ kind: "supplier", supplier: c });
    }
    if (!exact) options.push({ kind: "new" });
  }

  useEffect(() => setActive(0), [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(opt: Opt) {
    if (opt.kind === "supplier") {
      onChange(opt.supplier.name);
    } else {
      onPickNew?.();
    }
    setOpen(false);
  }

  const hasExact = exact !== null;
  const hasCandidates = !hasExact && candidates.length > 0;

  return (
    <div className="predictive" ref={boxRef}>
      <input
        value={value}
        placeholder={placeholder ?? "Select supplier"}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") {
            if (open && options.length > 0) {
              const opt = options[active];
              // Enter accepts the highlighted EXISTING supplier; for the
              // "add new" row, Enter falls through to the row-save so the
              // guard can confirm it first.
              if (opt.kind === "supplier") { e.preventDefault(); pick(opt); return; }
            }
            onEnter?.();
          }
          else if (e.key === "Escape") setOpen(false);
        }}
        style={{ width: "100%" }}
      />
      {open && options.length > 0 && (
        <div className="dropdown">
          {q.length === 0 && <div className="dd-head">All suppliers</div>}
          {hasCandidates && <div className="dd-warn">⚠ Not found — did you mean:</div>}
          {!hasExact && q.length > 0 && candidates.length === 0 && (
            <div className="dd-head">New supplier</div>
          )}
          {options.map((opt, i) => (
            <div
              key={opt.kind === "supplier" ? `s${opt.supplier.id}` : "new"}
              className={`option ${i === active ? "active" : ""} ${opt.kind === "new" ? "new" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(opt); }}
              onMouseEnter={() => setActive(i)}
            >
              {opt.kind === "supplier" ? (
                <div className="o-main">
                  <div className="o-name">{opt.supplier.name}</div>
                  {hasCandidates && <div className="o-sub">existing supplier</div>}
                </div>
              ) : (
                <div className="o-main">
                  <div className="o-name">＋ Add new supplier: “{q}”</div>
                  <div className="o-sub">only if this is really a new supplier</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
