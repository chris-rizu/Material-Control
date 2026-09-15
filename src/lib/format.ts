// Formatting helpers. Money is PHP (the shop's currency); dates are plain
// YYYY-MM-DD strings in the DB and rendered as-is (no timezone games).
import type { PurchaseFlat } from "./types";

export function php(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function qtyFmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

/** Today's date as YYYY-MM-DD in Asia/Manila (the shop's timezone). */
export function todayISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // en-CA gives YYYY-MM-DD
}

export function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${days[dt.getUTCDay()]}, ${months[m - 1]} ${d}, ${y}`;
}

export function shortDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "";
}

export function monthLabel(iso: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = Number(iso.slice(5, 7));
  return `${months[m - 1] ?? "?"} ${iso.slice(0, 4)}`;
}

// --- SI# ---------------------------------------------------------------------
// The SI box carries a fixed "SI#" prefix: the user types only the digits and
// the ledger stores the full "SI# <digits>" text (as PURCHASES (1).xlsx does).

/** "SI# 292713" → "292713"; anything that isn't pure digits after the prefix
 *  (N/A, receipt scribbles, blank) → "" — the ledger's no-number form. */
export function siDigits(raw: string): string {
  const rest = raw.trim().replace(/^SI#?\s*/i, "");
  return /^\d+$/.test(rest) ? rest : "";
}

/** "292713" → "SI# 292713"; blank / non-digits → "". */
export function toSiNo(digits: string): string {
  const d = digits.replace(/\D/g, "");
  return d ? `SI# ${d}` : "";
}

/**
 * Clean display text for the Particulars column, built from the structured
 * material. Angled fittings render size and angle separately —
 * "MOLDEX PVC ELBOW 6X90" displays as "MOLDEX PVC ELBOW 6 - 90°" —
 * and typo'd raw text displays corrected (EMEREALD -> EMERALD).
 */
export function displayParticulars(r: PurchaseFlat): string {
  const base = [r.material_brand, r.material_type, r.material_model_ver]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const size = (r.material_size_native ?? "").trim();
  const deg = Number(r.material_degrees ?? 0);
  if (!base && !size) return r.particulars_raw;
  let out = [base, size].filter(Boolean).join(" ");
  if (deg > 0) out = out ? `${out} - ${deg}°` : `${deg}°`;
  return out || r.particulars_raw;
}
