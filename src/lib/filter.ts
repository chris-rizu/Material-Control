// The one search/filter engine shared by the Purchases and Read-Only
// toolbars: free-text search + date range + supplier + project + status +
// category, all combinable. Both pages filter through filterPurchases so the
// two tabs can never drift apart.

import type { PurchaseFlat } from "./types";

export interface PurchaseFilters {
  search: string;
  dateFrom: string;
  dateTo: string;
  supId: number | "";
  proj: string;
  status: string;
  cat: number | "";
}

export const anyFilterOn = (f: PurchaseFilters): boolean =>
  Boolean(f.search || f.dateFrom || f.dateTo || f.supId !== "" || f.proj || f.status || f.cat !== "");

export function filterPurchases(rows: PurchaseFlat[], f: PurchaseFilters): PurchaseFlat[] {
  const needle = f.search.toUpperCase();
  return rows.filter((r) => {
    if (f.dateFrom && r.purchase_date < f.dateFrom) return false;
    if (f.dateTo && r.purchase_date > f.dateTo) return false;
    if (f.supId !== "" && r.supplier_id !== f.supId) return false;
    if (f.proj !== "" && (r.project_name ?? "").trim().toUpperCase() !== f.proj.toUpperCase()) return false;
    if (f.cat !== "" && r.category_id !== f.cat) return false;
    if (f.status === "repaired" && r.amount_source !== "import_missing_filled") return false;
    if (f.status === "receipt" && r.amount_source !== "manual") return false;
    if ((f.status === "ok" || f.status === "no-invoice" || f.status === "unreadable") && r.receipt_quality !== f.status) return false;
    if (!needle) return true;
    return (
      r.particulars_raw.toUpperCase().includes(needle) ||
      (r.supplier ?? "").toUpperCase().includes(needle) ||
      r.si_no.toUpperCase().includes(needle) ||
      (r.project_name ?? "").toUpperCase().includes(needle) ||
      (r.material ?? "").toUpperCase().includes(needle)
    );
  });
}

/**
 * Ledger convention (PURCHASES (1).xlsx): a line whose date + SI# + supplier
 * all equal the line shown above it belongs to the SAME receipt — its date /
 * SI# / supplier cells stay blank, exactly like the Excel. Computed against
 * the previous row in the displayed order, so filtering or sorting a block's
 * first line away simply promotes the next line to the header.
 */
export function sameInvoiceBlock(a: PurchaseFlat, b: PurchaseFlat): boolean {
  return (
    a.purchase_date === b.purchase_date &&
    a.si_no === b.si_no &&
    (a.supplier ?? "") === (b.supplier ?? "")
  );
}
