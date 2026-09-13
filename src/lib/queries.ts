// Data-access helpers (plain async functions; pages wrap them in TanStack Query).
import { supabase } from "./supabase";
import { canonicalKey, buildSearchName, parseParticulars } from "./parse";
import type {
  Category, Material, MaterialAlias, Profile, PurchaseFlat, SearchHit, Supplier,
  InvoiceBlock, ParsedParticulars,
} from "./types";

export { buildSearchName, parseParticulars, canonicalKey };

// --- auth / profiles --------------------------------------------------------

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles").select("*").order("created_at");
  if (error) throw error;
  return data as Profile[];
}

export async function updateProfile(id: string, patch: Partial<Profile>) {
  const { error } = await supabase.from("profiles").update(patch).eq("id", id);
  if (error) throw error;
}

// --- catalog ----------------------------------------------------------------

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories").select("*").order("sort");
  if (error) throw error;
  return data as Category[];
}

export async function searchMaterials(q: string, categoryId?: number | null): Promise<SearchHit[]> {
  const { data, error } = await supabase.rpc("search_materials", {
    q,
    p_category: categoryId ?? null,
    p_limit: 8,
  });
  if (error) throw error;
  return (data ?? []) as unknown as SearchHit[];
}

export async function fetchMaterials(): Promise<Material[]> {
  const { data, error } = await supabase
    .from("materials").select("*").order("search_name");
  if (error) throw error;
  return data as Material[];
}

export async function fetchAliases(materialId: number): Promise<MaterialAlias[]> {
  const { data, error } = await supabase
    .from("material_aliases").select("*")
    .eq("material_id", materialId).order("hit_count", { ascending: false });
  if (error) throw error;
  return data as MaterialAlias[];
}

/** Create a material from parsed fields; returns the new row (or the existing twin). */
export async function ensureMaterial(
  categoryId: number,
  parsed: ParsedParticulars,
  unit: string,
): Promise<Material> {
  const candidate = {
    category_id: categoryId,
    brand: parsed.brand,
    type: parsed.type,
    model_ver: parsed.model_ver,
    size_native: parsed.size_native,
    size_system: parsed.size_system,
    diameter: "",
    degrees: parsed.degrees,
    unit,
  };
  // Exact twin? (same category/brand/type/model/size/degrees)
  const { data: existing } = await supabase
    .from("materials").select("*")
    .eq("category_id", categoryId)
    .eq("brand", candidate.brand)
    .eq("type", candidate.type)
    .eq("model_ver", candidate.model_ver)
    .eq("size_native", candidate.size_native)
    .eq("degrees", candidate.degrees)
    .maybeSingle();
  if (existing) return existing as Material;

  const { data, error } = await supabase
    .from("materials").insert(candidate).select("*").single();
  if (error) throw error;
  return data as Material;
}

// --- suppliers --------------------------------------------------------------

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase
    .from("suppliers").select("*").order("name");
  if (error) throw error;
  return data as Supplier[];
}

/** Find supplier by normalized name, or create it. */
export async function ensureSupplier(name: string): Promise<Supplier> {
  const norm = name.toUpperCase().replace(/\s+/g, " ").trim();
  const { data: existing } = await supabase
    .from("suppliers").select("*").eq("name_norm", norm).maybeSingle();
  if (existing) return existing as Supplier;
  const { data, error } = await supabase
    .from("suppliers").insert({ name }).select("*").single();
  if (error) throw error;
  return data as Supplier;
}

// --- purchases --------------------------------------------------------------

export async function fetchPurchasesFlat(): Promise<PurchaseFlat[]> {
  const { data, error } = await supabase
    .from("purchases_flat")
    .select("*")
    .order("purchase_date")
    .order("line_seq")
    .order("id");
  if (error) throw error;
  return data as unknown as PurchaseFlat[];
}

/** Save one invoice block: one insert of N line rows (atomic; triggers run per row). */
export async function saveInvoiceBlock(block: InvoiceBlock, userId: string): Promise<number> {
  const rows = block.lines.map((l, i) => ({
    purchase_date: block.purchase_date,
    si_no: block.si_no,
    supplier_id: block.supplier_id,
    category_id: l.category_id,
    material_id: l.material_id,
    particulars_raw: l.particulars_raw,
    attributes: l.attributes,
    unit_price: l.unit_price === "" ? 0 : l.unit_price,
    quantity: l.quantity === "" ? 1 : l.quantity,
    amount_source: "computed",
    receipt_quality: block.si_no === "" || block.si_no === "N/A" ? "no-invoice" : "ok",
    line_seq: i,
    created_by: userId,
  }));
  const { error } = await supabase.from("purchases").insert(rows);
  if (error) throw error;
  return rows.length;
}

export async function deletePurchase(id: number) {
  const { error } = await supabase.from("purchases").delete().eq("id", id);
  if (error) throw error;
}

/** Patch a purchase row (sheet-page inline editing). */
export async function updatePurchase(id: number, patch: Record<string, unknown>) {
  const { error } = await supabase.from("purchases").update(patch).eq("id", id);
  if (error) throw error;
}

// --- import batches ---------------------------------------------------------

export async function fetchImportBatches() {
  const { data, error } = await supabase
    .from("import_batches")
    .select("*")
    .order("imported_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return data as Array<{
    id: string; filename: string; line_count: number;
    grand_total: number; imported_at: string;
  }>;
}

export async function findImportBatch(sha256: string) {
  const { data } = await supabase
    .from("import_batches").select("*").eq("file_sha256", sha256).maybeSingle();
  return data;
}

export async function recordImportBatch(
  filename: string, sha256: string, lineCount: number, grandTotal: number, userId: string,
) {
  const { data, error } = await supabase
    .from("import_batches")
    .insert({ filename, file_sha256: sha256, line_count: lineCount, grand_total: grandTotal, imported_by: userId })
    .select("*").single();
  if (error) throw error;
  return data;
}

// --- import material matching ----------------------------------------------

export interface MatchResult {
  material: Material | null;
  confidence: "exact" | "high" | "review" | "new";
  candidates: SearchHit[];
}

/**
 * Match a particulars string to the catalog:
 *   exact alias/canonical hit → high trigram score (≥0.72) → review band
 *   (0.50–0.71) → treated as new (<0.50).
 */
export async function matchMaterial(particulars: string): Promise<MatchResult> {
  const hits = await searchMaterials(particulars, null).catch(() => [] as SearchHit[]);

  const norm = particulars.toUpperCase().replace(/\s+/g, " ").trim();
  const key = canonicalKey(norm);

  // Exact: a hit whose search_name (or PIPE-dropped twin) equals the input.
  const exact = hits.find(
    (h) => h.search_name === norm || canonicalKey(h.search_name) === key,
  );
  if (exact) return { material: exact as unknown as Material, confidence: "exact", candidates: hits };

  const best = hits[0];
  if (best && best.score >= 0.72) {
    return { material: best as unknown as Material, confidence: "high", candidates: hits };
  }
  if (best && best.score >= 0.5) {
    return { material: null, confidence: "review", candidates: hits };
  }
  return { material: null, confidence: "new", candidates: hits };
}
