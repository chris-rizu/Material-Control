// Google Sheets export (replaced the old .xlsx download). The Google service
// account lives server-side in the plans site's Vercel function
// (material-control-plans/api/sheets-export.js) — never in this app, since
// the installer goes to other devices. The app sends the rows it already has
// plus the user's Supabase access token; the function builds the sheet in
// the PURCHASES layout (8 columns, Arial 11, centered, long dates,
// accounting money, blue Table Style Medium 9 look, auto-fitted columns) and
// answers with a link, which opens in the default browser.

import { useState } from "react";
import { supabase } from "./supabase";

export const SHEETS_EXPORT_URL =
  import.meta.env.VITE_SHEETS_EXPORT_URL || "https://material-control-plans.vercel.app/api/sheets-export";

export interface ExportRow {
  purchase_date: string;
  si_no: string;
  supplier: string | null;
  particulars_raw: string;
  project_name?: string | null;
  unit_price: number;
  quantity: number;
  amount: number;
}

const ERRORS: Record<string, string> = {
  not_configured: "Google Sheets export isn't set up on the server yet (service account / target sheet missing).",
  sign_in: "Your sign-in has expired — sign out and back in, then export again.",
  not_shared: "Google refused access — share the export spreadsheet (or folder) with the service account's email as Editor, and make sure the Sheets API is enabled.",
  sa_no_storage: "The service account has no Drive storage of its own — set GSHEETS_SPREADSHEET_ID to a spreadsheet you own and share it with the service account.",
  bad_request: "The export data was rejected — please report this.",
};

/** Build the sheet; resolves to the link of the new tab. */
export async function exportToGoogleSheets(rows: ExportRow[]): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(ERRORS.sign_in);
  let r: Response;
  try {
    r = await fetch(SHEETS_EXPORT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        rows: rows.map((x) => ({
          purchase_date: x.purchase_date,
          si_no: x.si_no,
          supplier: x.supplier ?? "",
          particulars_raw: x.particulars_raw,
          project_name: x.project_name ?? "",
          unit_price: Number(x.unit_price),
          quantity: Number(x.quantity),
          amount: Number(x.amount),
        })),
      }),
    });
  } catch {
    throw new Error("Couldn't reach the export server — check the internet connection.");
  }
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string; detail?: string };
  if (!r.ok || !j.url) {
    throw new Error(ERRORS[j.error ?? ""] ?? `Google Sheets export failed${j.detail ? `: ${j.detail}` : ` (${r.status})`}`);
  }
  return j.url;
}

/** Shared button state for the pages that export. */
export function useSheetsExport() {
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "err"; text: string; url?: string } | null>(null);
  async function run(rows: ExportRow[]) {
    setExporting(true);
    setResult(null);
    try {
      const url = await exportToGoogleSheets(rows);
      // Electron routes window.open to the default browser
      window.open(url, "_blank");
      setResult({ kind: "ok", text: `Exported ${rows.length.toLocaleString()} lines to Google Sheets.`, url });
    } catch (e) {
      setResult({ kind: "err", text: (e as Error).message });
    } finally {
      setExporting(false);
    }
  }
  return { exporting, result, clear: () => setResult(null), run };
}
