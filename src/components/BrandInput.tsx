// Predictive brand input for the entry row: suggests brands already in the
// catalog while typing (same mechanics as the supplier box — arrow keys +
// Enter accept, Esc closes). A brand not in the list is still allowed; it
// saves with the row and the Particulars tab manages the catalog itself.

import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Distinct brand names from the catalog (already loaded by the page). */
  brands: string[];
  placeholder?: string;
  /** Extra key-down hook (Enter on the row). Only fires when the dropdown
   *  is not offering a suggestion to accept. */
  onEnter?: () => void;
}

export default function BrandInput({ value, onChange, brands, placeholder, onEnter }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const q = value.trim().toUpperCase();
  const options = q.length === 0
    ? brands.slice(0, 8)
    : brands.filter((b) => b.toUpperCase().includes(q)).slice(0, 8);

  useEffect(() => setActive(0), [value]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(b: string) {
    onChange(b);
    setOpen(false);
  }

  return (
    <div className="predictive" ref={boxRef}>
      <input
        value={value}
        placeholder={placeholder ?? "Brand — optional"}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") {
            if (open && options.length > 0 && options[active]) {
              e.preventDefault();
              pick(options[active]);
              return;
            }
            onEnter?.();
          }
          else if (e.key === "Escape") setOpen(false);
        }}
        style={{ width: "100%" }}
      />
      {open && options.length > 0 && (
        <div className="dropdown">
          {q.length === 0 && <div className="dd-head">Brands in your catalog</div>}
          {options.map((b, i) => (
            <div
              key={b}
              className={`option ${i === active ? "active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(b); }}
              onMouseEnter={() => setActive(i)}
            >
              <div className="o-main">
                <div className="o-name">{b}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
