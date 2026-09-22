// Google Drive copies of the app's receipt photos. The plans site's
// /api/drive-receipt (token-checked, same trust model as the Sheets export)
// relays each photo through the owner's Apps Script into a "Material Control
// app receipts" folder in their Drive; a name that's already there is
// skipped, so the backup below can re-run without duplicating. All of this
// is best effort: the Supabase `receipts` bucket stays the master copy the
// app reads, and a failed copy never blocks an upload or the backup.

import { supabase } from "./supabase";
import type { Receipt } from "./types";

export const DRIVE_RECEIPT_URL =
  import.meta.env.VITE_DRIVE_RECEIPT_URL || "https://material-control-plans.vercel.app/api/drive-receipt";

const MAX_BYTES = 3 * 1024 * 1024; // the function's cap, with headroom

const ERRORS: Record<string, string> = {
  not_configured: "Google Drive backup isn't set up on the server yet.",
  sign_in: "Your sign-in has expired — sign out and back in, then try again.",
  size: "That photo is too large for the Drive copy (over 3 MB).",
  bad_request: "The backup data was rejected — please report this.",
};

type ReceiptKey = Pick<Receipt, "purchase_date" | "si_no" | "supplier_id">;

/** Drive filename for a receipt — one per invoice block, so it's unique per
 *  photo, readable in the folder, and stable for skip-on-name re-runs. */
export function receiptDriveName(r: ReceiptKey, suppliers: Map<number, string>): string {
  const clean = (s: string) => s.replace(/[/\\:*?"<>|&]/g, "-").replace(/\s+/g, " ").trim() || "-";
  const si = clean(r.si_no || "no invoice #");
  const sup = clean(r.supplier_id != null ? suppliers.get(r.supplier_id) ?? `supplier ${r.supplier_id}` : "no supplier");
  return `${r.purchase_date} - ${si} - ${sup}.jpg`;
}

async function suppliersMap(): Promise<Map<number, string>> {
  const { data } = await supabase.from("suppliers").select("id, name");
  return new Map(((data ?? []) as { id: number; name: string }[]).map((s) => [s.id, s.name]));
}

async function dataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error ?? new Error("The photo couldn't be read."));
    fr.readAsDataURL(blob);
  });
}

/** Copy one photo; resolves skipped=true when Drive already had that name. */
export async function copyReceiptToDrive(name: string, blob: Blob): Promise<{ skipped: boolean }> {
  if (blob.size > MAX_BYTES) throw new Error(ERRORS.size);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(ERRORS.sign_in);
  let r: Response;
  try {
    r = await fetch(DRIVE_RECEIPT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, contentType: blob.type || "image/jpeg", data: await dataUrl(blob) }),
    });
  } catch {
    throw new Error("Couldn't reach the backup server — check the internet connection.");
  }
  const j = (await r.json().catch(() => ({}))) as { id?: string; skipped?: boolean; error?: string; detail?: string };
  if (!r.ok || !j.id) {
    throw new Error(ERRORS[j.error ?? ""] ?? `The Drive copy failed${j.detail ? `: ${j.detail}` : ` (${r.status})`}`);
  }
  return { skipped: Boolean(j.skipped) };
}

/** Fire-and-forget copy right after a successful upload. Never throws. */
export function copyNewReceipt(r: ReceiptKey, blob: Blob): void {
  void (async () => {
    try {
      await copyReceiptToDrive(receiptDriveName(r, await suppliersMap()), blob);
    } catch { /* Drive is the archive; the bucket copy is what the app reads */ }
  })();
}

export interface BackupProgress { done: number; total: number; }
export interface BackupResult { copied: number; skipped: number; failed: number; total: number; }

/** Back up every filed receipt photo. Re-runnable: Drive skips names it has. */
export async function backupReceiptsToDrive(onProgress: (p: BackupProgress) => void): Promise<BackupResult> {
  const { data, error } = await supabase.from("receipts").select("*").order("purchase_date");
  if (error) throw new Error(error.message);
  const receipts = (data ?? []) as Receipt[];
  const suppliers = await suppliersMap();
  const out: BackupResult = { copied: 0, skipped: 0, failed: 0, total: receipts.length };
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    onProgress({ done: i, total: receipts.length });
    try {
      const { data: blob, error: dErr } = await supabase.storage.from("receipts").download(r.storage_path);
      if (dErr || !blob) throw dErr ?? new Error("download failed");
      const res = await copyReceiptToDrive(receiptDriveName(r, suppliers), blob);
      res.skipped ? out.skipped++ : out.copied++;
    } catch (e) {
      const m = (e as Error).message ?? "";
      // nothing can succeed if the server isn't set up or the session died —
      // say why instead of "N failed, try again later"
      if (m === ERRORS.not_configured || m === ERRORS.sign_in) throw e;
      out.failed++;
    }
  }
  onProgress({ done: receipts.length, total: receipts.length });
  return out;
}
