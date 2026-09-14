import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchMaterials } from "../lib/queries";
import { IconEnter, IconSearch } from "./icons";
import type { SearchHit } from "../lib/types";

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Called when the user accepts a suggestion. */
  onPick: (hit: SearchHit | null) => void;
  categoryId?: number | null;
  placeholder?: string;
  /** Extra key-down hook (e.g. Enter saves the whole row). */
  onEnter?: () => void;
}

/**
 * Predictive particulars input: debounced trigram search over the material
 * catalog + its alias history. Arrow keys + Enter accept; Esc closes.
 * New particulars are NOT offered as a dropdown row — whatever is typed is
 * saved with the row and auto-created (the Particulars tab manages the
 * catalog itself).
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

  const options: SearchHit[] = hits;

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
      // search_name omits degrees ("... ELBOW 3"), so putting it back in the
      // box verbatim would let the row re-match the 45° twin at save time.
      // Keep the angle in the text ("... ELBOW 3X90") — the parser reads it
      // and the matcher then only accepts materials with the same degrees.
      const deg = Number(opt.degrees ?? 0);
      onChange(deg > 0 ? `${opt.search_name}X${deg}` : opt.search_name);
      onPick(opt);
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
              if (opt && opt.search_name === value.trim().toUpperCase()) {
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
              key={`m${opt.id}`}
              className={`option ${i === active ? "active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
              onMouseEnter={() => setActive(i)}
            >
              <div className="o-main">
                <div className="o-name">{opt.search_name}</div>
                <div className="o-sub">
                  {[
                    opt.brand || null,
                    opt.type || null,
                    opt.size_native || null,
                    opt.degrees ? `${opt.degrees}°` : null,
                  ].filter(Boolean).join(" · ")}
                </div>
              </div>
              {opt.last_unit_price != null && (
                <span className="o-price">₱{Number(opt.last_unit_price).toFixed(2)}</span>
              )}
              <span className="o-enter"><IconEnter size={15} /></span>
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
