import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchMaterials } from "../lib/queries";
import { IconEnter, IconSearch } from "./icons";
import type { SearchHit } from "../lib/types";

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Called when the user accepts a suggestion (null = keep raw text as new). */
  onPick: (hit: SearchHit | null) => void;
  categoryId?: number | null;
  placeholder?: string;
  /** Extra key-down hook (e.g. Enter saves the whole row). */
  onEnter?: () => void;
}

/**
 * Predictive particulars input: debounced trigram search over the material
 * catalog + its alias history. Arrow keys + Enter accept; Esc closes.
 */
export default function PredictiveMaterialInput({
  value, onChange, onPick, categoryId, placeholder, onEnter,
}: Props) {
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 150);
    return () => clearTimeout(t);
  }, [value]);

  const { data: hits = [] } = useQuery({
    queryKey: ["material-search", debounced, categoryId ?? null],
    queryFn: () => searchMaterials(debounced, categoryId ?? null),
    enabled: open && debounced.trim().length >= 2,
  });

  const showNew = debounced.trim().length >= 2;
  const options: Array<{ hit: SearchHit | null; label: string }> = [
    ...hits.map((h) => ({ hit: h as SearchHit, label: h.search_name })),
    ...(showNew ? [{ hit: null, label: `Add “${debounced.trim()}” as a new material` }] : []),
  ];

  useEffect(() => setActive(0), [debounced]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(i: number) {
    const opt = options[i];
    if (opt) {
      if (opt.hit) onChange(opt.hit.search_name);
      onPick(opt.hit);
    }
    setOpen(false);
  }

  return (
    <div className="predictive" ref={boxRef}>
      <input
        value={value}
        placeholder={placeholder ?? "Type material — e.g. MOLDEX WYE"}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter") {
            if (open && options.length > 0 && debounced.trim().length >= 2) {
              // If the exact typed text matches the highlighted suggestion's name,
              // accept the suggestion (prefills price etc.); otherwise let Enter
              // fall through to the row-save handler.
              const opt = options[active];
              if (opt && opt.hit && opt.hit.search_name === value.trim().toUpperCase()) {
                e.preventDefault();
                pick(active);
                return;
              }
            }
            onEnter?.();
          }
          else if (e.key === "Escape") setOpen(false);
        }}
        style={{ width: "100%" }}
      />
      {open && options.length > 0 && (
        <div className="dropdown">
          <div className="dd-head">Suggestions from your history</div>
          {options.map((opt, i) => (
            <div
              key={opt.hit ? `m${opt.hit.id}` : "new"}
              className={`option ${i === active ? "active" : ""} ${opt.hit ? "" : "new"}`}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
              onMouseEnter={() => setActive(i)}
            >
              {opt.hit ? (
                <>
                  <div className="o-main">
                    <div className="o-name">{opt.hit.search_name}</div>
                    <div className="o-sub">
                      {[
                        opt.hit.brand || null,
                        opt.hit.type || null,
                        opt.hit.size_native || null,
                        opt.hit.degrees ? `${opt.hit.degrees}°` : null,
                      ].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {opt.hit.last_unit_price != null && (
                    <span className="o-price">₱{Number(opt.hit.last_unit_price).toFixed(2)}</span>
                  )}
                  <span className="o-enter"><IconEnter size={15} /></span>
                </>
              ) : (
                <div className="o-main">
                  <div className="o-name">{opt.label}</div>
                  <div className="o-sub">Nothing matches yet — press Enter to save it as typed</div>
                </div>
              )}
            </div>
          ))}
          <div className="dd-foot">
            <IconSearch size={13} /> Press Enter to add, or type to search all materials...
          </div>
        </div>
      )}
    </div>
  );
}
