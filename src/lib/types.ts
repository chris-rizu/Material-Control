// Database row types + app-side types for Material Control.

export type Role = "owner" | "encoder" | "viewer";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  unit: string;
  sort: number;
  attribute_template: AttributeField[];
}

/** One form field definition coming from categories.attribute_template. */
export interface AttributeField {
  key: string;
  label: string;
  widget: "text" | "select";
  required?: boolean;
  predictive?: boolean;
  options?: (string | number)[];
  default?: string;
  placeholder?: string;
  /** Only show this field when another field's value contains any of these. */
  show_if?: { field: string; contains_any: string[] };
}

export type SizeSystem = "english" | "metric" | "n/a";

export interface Material {
  id: number;
  category_id: number;
  brand: string;
  type: string;
  model_ver: string;
  size_native: string;
  size_system: SizeSystem;
  size_metric: string;
  diameter: string;
  degrees: number; // 0 = no angle
  unit: string;
  search_name: string;
  reference_price: number | null;
  usage_count: number;
  last_used_at: string | null;
}

export interface MaterialAlias {
  id: number;
  alias_text: string;
  material_id: number;
  hit_count: number;
  last_used_at: string;
}

export interface Supplier {
  id: number;
  name: string;
}

/** One row of the projects catalog (Particulars tab → Projects card). */
export interface Project {
  id: number;
  name: string;
  name_norm: string;
  created_at: string;
}

export interface Purchase {
  id: number;
  purchase_date: string; // YYYY-MM-DD
  si_no: string;
  supplier_id: number | null;
  category_id: number | null;
  material_id: number | null;
  particulars_raw: string;
  attributes: Record<string, string | number>;
  unit_price: number;
  quantity: number;
  amount: number;
  amount_source: "computed" | "manual" | "import_missing_filled";
  amount_recomputed: number;
  receipt_quality: "ok" | "unreadable" | "no-invoice";
  line_seq: number;
  import_batch_id: string | null;
  notes: string;
  created_by: string | null;
  created_at: string;
}

/** Flattened row from the purchases_flat view. */
export interface PurchaseFlat {
  id: number;
  purchase_date: string;
  si_no: string;
  supplier: string | null;
  category: string | null;
  material: string | null;
  material_brand: string | null;
  material_type: string | null;
  material_model_ver: string | null;
  material_size_native: string | null;
  material_degrees: number | null;
  particulars_raw: string;
  attributes: Record<string, string | number>;
  unit_price: number;
  quantity: number;
  amount: number;
  amount_source: "computed" | "manual" | "import_missing_filled";
  amount_recomputed: number;
  receipt_quality: "ok" | "unreadable" | "no-invoice";
  line_seq: number;
  notes: string;
  created_at: string;
  material_id: number | null;
  supplier_id: number | null;
  category_id: number | null;
  project_name: string | null;
}

/** One filed receipt photo, keyed to an invoice block (date + SI# + supplier —
 *  the same grouping the ledger uses, so blank-SI blocks file one photo too). */
export interface Receipt {
  id: number;
  purchase_date: string; // YYYY-MM-DD
  si_no: string;         // "SI# 123" or "" (blank = same-receipt block)
  supplier_id: number | null;
  storage_path: string;  // path inside the private `receipts` bucket
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_by: string | null;
  created_at: string;
}

/** One row of the History tab (activity_log table). */
export interface ActivityEntry {
  id: number;
  acted_at: string;
  actor: string;
  action: "insert" | "update" | "delete" | "restore";
  table_name: "purchases" | "suppliers" | "materials";
  row_id: number | null;
  summary: string;
  details: Record<string, unknown> | { old: Record<string, unknown>; new: Record<string, unknown> } | null;
}

export interface SearchHit extends Material {
  score: number;
  last_unit_price: number | null;
}

/** One invoice block being entered/edited: header + line items. */
export interface LineItem {
  clientKey: string; // stable key for React lists
  category_id: number | null;
  material_id: number | null;
  particulars_raw: string;
  attributes: Record<string, string | number>;
  unit_price: number | "";
  quantity: number | "";
}

export interface InvoiceBlock {
  purchase_date: string;
  si_no: string;
  supplier_id: number | null;
  project_name: string;
  lines: LineItem[];
}

/** Result of parsing a free-text particulars string. */
export interface ParsedParticulars {
  brand: string;
  type: string;
  model_ver: string;
  size_native: string;
  size_system: SizeSystem;
  degrees: number;
  normalized: string; // canonicalized full text
}
