// Shared ordering for the purchases tables (Purchases + Read-Only): click the
// Date or Project header to sort. Lines without a project always sink to the
// bottom; ties fall back to newest first.
import type { PurchaseFlat } from "./types";

export type SortKey = "date" | "project";
export type SortDir = "asc" | "desc";

export function comparePurchases(a: PurchaseFlat, b: PurchaseFlat, key: SortKey, dir: SortDir): number {
  if (key === "date") {
    if (a.purchase_date !== b.purchase_date) {
      const cmp = a.purchase_date < b.purchase_date ? -1 : 1;
      return dir === "asc" ? cmp : -cmp;
    }
    return b.id - a.id;
  }
  const pa = (a.project_name ?? "").trim().toUpperCase();
  const pb = (b.project_name ?? "").trim().toUpperCase();
  if (pa !== pb) {
    if (!pa) return 1;
    if (!pb) return -1;
    return dir === "asc" ? pa.localeCompare(pb) : pb.localeCompare(pa);
  }
  // same project: newest purchase first
  if (a.purchase_date !== b.purchase_date) return a.purchase_date < b.purchase_date ? 1 : -1;
  return b.id - a.id;
}
