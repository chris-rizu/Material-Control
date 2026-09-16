// Data-access helpers (plain async functions; pages wrap them in TanStack Query).
import { supabase } from "./supabase";
import { canonicalKey, buildSearchName, parseParticulars } from "./parse";
import { toReceiptJpeg } from "./receiptImage";
import type {
  Category, Material, MaterialAlias, Profile, Project, PurchaseFlat, Receipt, SearchHit, Supplier,
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

/** Add a category to the catalog; returns the existing twin when the name is
 *  already there (compared case-insensitively). Sorts to the bottom of the
 *  list. */
export async function addCategory(name: string, unit = "pc"): Promise<Category> {
  const clean = name.trim().replace(/\s+/g, " ");
  const { data: existing } = await supabase
    .from("categories").select("*").ilike("name", clean).maybeSingle();
  if (existing) return existing as Category;
  const { data: last } = await supabase
    .from("categories").select("sort").order("sort", { ascending: false }).limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("categories")
    .insert({ name: clean, unit, sort: (last?.sort ?? 0) + 1 })
    .select("*").single();
  if (error) throw error;
  return data as Category;
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

// --- projects (the catalog behind the Particulars tab's Projects card) -------

export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects").select("*").order("name");
  if (error) throw error;
  return data as Project[];
}

/** Add a project to the catalog; returns the existing twin if one matches. */
export async function addProject(name: string): Promise<Project> {
  const clean = name.trim().replace(/\s+/g, " ");
  const { data: existing } = await supabase
    .from("projects").select("*").eq("name_norm", clean.toUpperCase()).maybeSingle();
  if (existing) return existing as Project;
  const { data, error } = await supabase
    .from("projects").insert({ name: clean }).select("*").single();
  if (error) throw error;
  return data as Project;
}

/** Best-effort cataloging used by the Purchases save: a typed project name
 *  lands in the catalog automatically. A duplicate is fine (already there);
 *  a missing table (migration_004 not run yet) must never block the save. */
export async function ensureProject(name: string): Promise<void> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return;
  const { error } = await supabase.from("projects").insert({ name: clean });
  if (error && error.code !== "23505") throw error; // 23505 = already catalogued
}

export async function deleteProject(id: number) {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}

/** Rename a catalogued project (name_norm regenerates server-side). */
export async function updateProjectName(id: number, name: string) {
  const clean = name.trim().replace(/\s+/g, " ");
  const { error } = await supabase.from("projects").update({ name: clean }).eq("id", id);
  if (error) throw error;
}

/** Project names live on purchase lines as free text, so a rename also
 *  re-points every ledger line using the old name (any casing). */
export async function renameProjectLines(oldName: string, newName: string) {
  const { error } = await supabase
    .from("purchases").update({ project_name: newName }).ilike("project_name", oldName);
  if (error) throw error;
}

// --- categories / suppliers / materials management ---------------------------

export async function updateCategory(id: number, patch: { name?: string; unit?: string }) {
  const { error } = await supabase.from("categories").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCategory(id: number) {
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw error;
}

export async function updateSupplierName(id: number, name: string) {
  const { error } = await supabase.from("suppliers").update({ name: name.trim() }).eq("id", id);
  if (error) throw error;
}

export async function deleteSupplier(id: number) {
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) throw error;
}

/** Patch a material's catalog fields (search_name regenerates server-side). */
export async function updateMaterial(id: number, patch: Partial<Material>) {
  const { error } = await supabase.from("materials").update(patch).eq("id", id);
  if (error) throw error;
}

/** Purchases keep their typed particulars (material_id set nulls server-side)
 *  and aliases cascade away. */
export async function deleteMaterial(id: number) {
  const { error } = await supabase.from("materials").delete().eq("id", id);
  if (error) throw error;
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
    project_name: (block.project_name ?? "").trim(),
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

// --- receipts (photos of sales invoices) -------------------------------------

export async function fetchReceipts(): Promise<Receipt[]> {
  const { data, error } = await supabase
    .from("receipts").select("*")
    .order("purchase_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Receipt[];
}

/** The receipt photo filed for an invoice block (date + SI# + supplier). */
export function receiptForBlock(
  receipts: Receipt[], purchaseDate: string, siNo: string, supplierId: number | null,
): Receipt | undefined {
  return receipts.find(
    (r) => r.purchase_date === purchaseDate
      && r.si_no === siNo
      && (r.supplier_id ?? null) === (supplierId ?? null),
  );
}

function receiptSetupError(e: { code?: string; message?: string }): Error {
  const notSetup =
    e.code === "PGRST205" ||
    (e.message ?? "").includes("schema cache") ||
    (e.message ?? "").includes("Could not find the table");
  if (notSetup) {
    return new Error(
      "Receipts aren't in the database yet — run supabase/migration_005_receipts.sql "
      + "in the Supabase SQL Editor, then try again.",
    );
  }
  return new Error(e.message ?? "The receipt couldn't be saved.");
}

async function findReceiptRow(
  purchaseDate: string, siNo: string, supplierId: number | null,
): Promise<Receipt | null> {
  let q = supabase.from("receipts").select("*")
    .eq("purchase_date", purchaseDate).eq("si_no", siNo);
  q = supplierId == null ? q.is("supplier_id", null) : q.eq("supplier_id", supplierId);
  const { data, error } = await q.maybeSingle();
  if (error) throw receiptSetupError(error);
  return (data as Receipt) ?? null;
}

/**
 * File a photo for an invoice block. The image is downscaled to a max-1600px
 * JPEG in the browser first (phone photos are 3-6MB; receipts stay sharp at a
 * fraction of that). Filing a block that already has a photo replaces it.
 */
export async function uploadReceipt(args: {
  purchaseDate: string; siNo: string; supplierId: number | null; file: File | Blob;
}): Promise<{ replaced: boolean }> {
  const { purchaseDate, siNo, supplierId, file } = args;
  const { blob } = await toReceiptJpeg(file);

  const existing = await findReceiptRow(purchaseDate, siNo, supplierId);

  const digits = siNo.replace(/\D/g, "");
  const path =
    `${purchaseDate}/si${digits ? `-${digits}` : "-none"}_${supplierId ?? 0}_${Date.now()}.jpg`;
  const { error: upErr } = await supabase.storage
    .from("receipts").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (upErr) {
    if ((upErr.message ?? "").includes("Bucket not found") || upErr.statusCode === "404") {
      throw new Error(
        "The receipts storage bucket isn't set up yet — run "
        + "supabase/migration_005_receipts.sql in the Supabase SQL Editor, then try again.",
      );
    }
    throw upErr;
  }

  // Re-filing a block: swap the old photo out (row + object) before inserting.
  if (existing) {
    const { error: delErr } = await supabase.from("receipts").delete().eq("id", existing.id);
    if (delErr) {
      await supabase.storage.from("receipts").remove([path]);
      throw delErr;
    }
    await supabase.storage.from("receipts").remove([existing.storage_path]);
  }

  const { data: me } = await supabase.auth.getUser();
  const { error: insErr } = await supabase.from("receipts").insert({
    purchase_date: purchaseDate,
    si_no: siNo,
    supplier_id: supplierId,
    storage_path: path,
    file_name: file instanceof File ? file.name : "",
    mime_type: "image/jpeg",
    file_size: blob.size,
    uploaded_by: me.user?.id ?? null,
  });
  if (insErr) {
    await supabase.storage.from("receipts").remove([path]); // no orphan photo
    throw receiptSetupError(insErr);
  }
  return { replaced: Boolean(existing) };
}

/** Delete a filed receipt: the row first, then the stored photo (best-effort —
 *  a leftover object is harmless, a row pointing at nothing is not). */
export async function deleteReceipt(id: number, storagePath: string) {
  const { error } = await supabase.from("receipts").delete().eq("id", id);
  if (error) throw error;
  await supabase.storage.from("receipts").remove([storagePath]).catch(() => { /* orphan ok */ });
}

/** Short-lived view URL for one photo (the bucket is private). */
export async function signReceiptUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("receipts").createSignedUrl(path, 3600);
  if (error) throw error;
  const d = data as { signedUrl?: string; signedURL?: string };
  return d.signedUrl ?? d.signedURL ?? "";
}

/** View URLs for a list of photos (thumbnails). Order matches the input. */
export async function signReceiptUrls(paths: string[]): Promise<(string | null)[]> {
  if (!paths.length) return [];
  const { data, error } = await supabase.storage.from("receipts").createSignedUrls(paths, 3600);
  if (error) throw error;
  const byPath = new Map(
    ((data ?? []) as Array<{ path: string; signedUrl?: string; signedURL?: string }>)
      .map((d) => [d.path, d.signedUrl ?? d.signedURL ?? null] as const),
  );
  return paths.map((p) => byPath.get(p) ?? null);
}

// --- history (activity log) ---------------------------------------------------

/** Newest-first page of the activity log (what was added/changed/deleted). */
export async function fetchActivity(limit = 100, offset = 0) {
  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .order("acted_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as import("./types").ActivityEntry[];
}

/** Put a deleted row back (owner/encoder only; enforced again server-side). */
export async function restoreActivity(logId: number): Promise<string> {
  const { data, error } = await supabase.rpc("restore_activity", { p_log_id: logId });
  if (error) throw error;
  return String(data ?? "Restored.");
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
 *
 * Angled inputs (ELBOW/BEND with "nX90"-style sizes) only ever auto-link to
 * a material carrying the SAME angle: search_name doesn't include degrees,
 * so text similarity alone can't tell "ELBOW 3X45" from "ELBOW 3X90".
 */
export async function matchMaterial(particulars: string): Promise<MatchResult> {
  const hits = await searchMaterials(particulars, null).catch(() => [] as SearchHit[]);

  const norm = particulars.toUpperCase().replace(/\s+/g, " ").trim();
  const key = canonicalKey(norm);
  const parsed = parseParticulars(particulars);
  const angleAgrees = (h: SearchHit) =>
    parsed.degrees === 0 || Number(h.degrees ?? 0) === parsed.degrees;

  // Exact: a hit whose search_name (or PIPE-dropped twin) equals the input —
  // and whose angle matches when the input carries one.
  const exact = hits.find(
    (h) =>
      angleAgrees(h) &&
      (h.search_name === norm || canonicalKey(h.search_name) === key),
  );
  if (exact) return { material: exact as unknown as Material, confidence: "exact", candidates: hits };

  const best = hits.find(angleAgrees);
  if (best && best.score >= 0.72) {
    return { material: best as unknown as Material, confidence: "high", candidates: hits };
  }
  if (hits[0] && hits[0].score >= 0.5) {
    return { material: null, confidence: "review", candidates: hits };
  }
  return { material: null, confidence: "new", candidates: hits };
}
