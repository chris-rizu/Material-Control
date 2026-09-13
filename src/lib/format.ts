// Formatting helpers. Money is PHP (the shop's currency); dates are plain
// YYYY-MM-DD strings in the DB and rendered as-is (no timezone games).

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
