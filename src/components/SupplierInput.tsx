// Predictive supplier input: suggests existing suppliers while typing, so a
// typo shows "did you mean?" instead of silently creating a bogus supplier.
// New suppliers are NOT offered as a dropdown row — whatever is typed is
// saved with the row and auto-created (the Suppliers tab manages the
// directory itself).

import { useEffect, useRef, useState } from "react";
import { matchSuppliers } from "../lib/supplierMatch";
import type { Supplier } from "../lib/types";

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Full supplier list (already loaded by the page). */
  suppliers: Supplier[];
  placeholder?: string;
  /** Extra key-down hook (Enter on the row). Only fires when the dropdown
   *  is not offering a suggestion to accept. */
  onEnter?: () => void;
}

export default function SupplierInput({
  value, onChange, suppliers, placeholder, onEnter,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const q = value.trim();
  const { exact, candidates } = matchSuppliers(q, suppliers);

  let options: Supplier[];
  if (q.length === 0) {
    // nothing typed — show the known suppliers to pick from
    options = suppliers.slice(0, 8);
  } else {
    options = [];
    if (exact) options.push(exact);
    for (const c of candidates) {
      if (exact && c.id === exact.id) continue;
      options.push(c);
    }
  }

  useEffect(() => setActive(0), [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(s: Supplier) {
    onChange(s.name);
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
              // Enter accepts the highlighted EXISTING supplier; otherwise it
              // falls through to the row-save so the guard can confirm first.
              if (opt) { e.preventDefault(); pick(opt); return; }
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
          {options.map((opt, i) => (
            <div
              key={`s${opt.id}`}
              className={`option ${i === active ? "active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(opt); }}
              onMouseEnter={() => setActive(i)}
            >
              <div className="o-main">
                <div className="o-name">{opt.name}</div>
                {hasCandidates && <div className="o-sub">existing supplier</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
