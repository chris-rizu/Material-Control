// Predictive search box shared by the Purchases and Read-Only toolbars:
// while you type, it suggests actual values from the loaded ledger — items,
// suppliers, SI#s and projects — grouped by kind. Accepting a suggestion
// (click or Enter) fills the box with that exact value, so the filter assumes
// what you meant instead of a half-typed guess. Suggestions come straight
// from the rows already on screen, so both tabs predict identically.

import { useEffect, useMemo, useRef, useState } from "react";
import { IconSearch } from "./icons";
import type { PurchaseFlat } from "../lib/types";

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** The loaded ledger rows — suggestions are drawn from them. */
  rows: PurchaseFlat[];
  placeholder?: string;
}

/** Distinct values, first-seen casing kept, blanks dropped. */
const firstSeen = (values: (string | null | undefined)[]): string[] => {
  const seen = new Map<string, string>();
  for (const v of values) {
    const s = (v ?? "").trim();
    if (s && !seen.has(s.toUpperCase())) seen.set(s.toUpperCase(), s);
  }
  return [...seen.values()];
};

export default function PredictiveSearchInput({ value, onChange, rows, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const needle = value.trim().toUpperCase();
  const groups = useMemo(() => {
    if (needle.length < 2) return [] as { label: string; values: string[] }[];
    const take = (vals: string[]) =>
      vals.filter((v) => v.toUpperCase().includes(needle)).slice(0, 3);
    return [
      { label: "Items", values: take(firstSeen(rows.map((r) => r.material || r.particulars_raw))) },
      { label: "Suppliers", values: take(firstSeen(rows.map((r) => r.supplier))) },
      { label: "SI#", values: take(firstSeen(rows.map((r) => r.si_no))) },
      { label: "Projects", values: take(firstSeen(rows.map((r) => r.project_name))) },
    ].filter((g) => g.values.length > 0);
  }, [rows, needle]);

  const flat = useMemo(() => groups.flatMap((g) => g.values), [groups]);

  useEffect(() => setActive(0), [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  return (
    <div className="predictive searchbar" ref={boxRef}>
      <IconSearch size={16} />
      <input
        value={value}
        placeholder={placeholder ?? "Search by SI#, supplier, project, item, or particulars..."}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") {
            if (open && flat[active]) { e.preventDefault(); pick(flat[active]); }
            else setOpen(false);
          }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && flat.length > 0 && (
        <div className="dropdown">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="dd-head">{g.label}</div>
              {g.values.map((v) => {
                const i = flat.indexOf(v);
                return (
                  <div key={`${g.label}${v}`}
                    className={`option ${i === active ? "active" : ""}`}
                    onMouseDown={(e) => { e.preventDefault(); pick(v); }}
                    onMouseEnter={() => setActive(i)}
                  >
                    <div className="o-main"><div className="o-name">{v}</div></div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
