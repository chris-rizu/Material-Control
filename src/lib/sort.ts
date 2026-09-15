// Shared ordering for the purchases tables (Purchases + Read-Only): click the
// Date or Project header to sort. Lines without a project always sink to the
// bottom; ties keep each invoice block contiguous and in receipt order
// (line_seq top-down), so the blank date/SI#/supplier continuation cells read
// exactly like the Excel ledger.
import type { PurchaseFlat } from "./types";

export type SortKey = "date" | "project";
export type SortDir = "asc" | "desc";

/** Same-day tie-break: block by block, each block line_seq top-down. */
function byBlock(a: PurchaseFlat, b: PurchaseFlat): number {
  if (a.si_no !== b.si_no) return a.si_no < b.si_no ? -1 : 1;
  if ((a.supplier ?? "") !== (b.supplier ?? "")) {
    return (a.supplier ?? "") < (b.supplier ?? "") ? -1 : 1;
  }
  if (a.line_seq !== b.line_seq) return a.line_seq - b.line_seq;
  return b.id - a.id;
}

export function comparePurchases(a: PurchaseFlat, b: PurchaseFlat, key: SortKey, dir: SortDir): number {
  if (key === "date") {
    if (a.purchase_date !== b.purchase_date) {
      const cmp = a.purchase_date < b.purchase_date ? -1 : 1;
      return dir === "asc" ? cmp : -cmp;
    }
    return byBlock(a, b);
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
  return byBlock(a, b);
}
