// Verifies the Excel export format: Blue Table Style Medium 9, Calibri 11,
// bold capitalized headers, and the same-receipt ledger convention (blank
// date/SI/supplier on continuation lines). Clicks the app's own Export
// button, saves the download, and parses it back with exceljs.
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";
const OUT = "shots/exports/purchases-check.xlsx";

const blk = (id, seq, part, price, qty, amount) => ({
  id, purchase_date: "2026-09-10", si_no: "SI# 292713", supplier: "HARDWARE A", supplier_id: 1,
  category: "PVC Pipes & Fittings", category_id: 3, material: part, material_id: 10 + seq,
  particulars_raw: part, project_name: "MCDO", unit_price: price, quantity: qty, amount,
  amount_source: "computed", receipt_quality: "ok", line_seq: seq,
  material_brand: "MOLDEX", material_type: part, material_model_ver: null,
  material_size_native: "", material_degrees: null, created_at: "2026-09-10T02:00:00Z",
  attributes: {}, notes: "",
});
const flat = [
  blk(101, 0, "PVC TEE 3X3", 374.8, 3, 1124.4),
  blk(102, 1, "PVC ELBOW 3X90", 350, 1, 350),
  blk(103, 2, "PVC PIPE 4", 240, 2, 480),
  { id: 104, purchase_date: "2026-09-09", si_no: "", supplier: "CEMENT CO", supplier_id: 2,
    category: "Cement", category_id: 4, material: null, material_id: null,
    particulars_raw: "ASSORTED NAILS", project_name: "Talisay", unit_price: 50, quantity: 2,
    amount: 100, amount_source: "manual", receipt_quality: "no-invoice", line_seq: 0,
    material_brand: null, material_type: null, material_model_ver: null,
    material_size_native: "", material_degrees: null, created_at: "2026-09-09T02:00:00Z",
    attributes: {}, notes: "" },
];
const suppliers = [
  { id: 1, name: "HARDWARE A", name_norm: "HARDWARE A" },
  { id: 2, name: "CEMENT CO", name_norm: "CEMENT CO" },
];

const json = (body, status = 200) => ({
  status, contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});

async function routeSupabase(route) {
  const url = route.request().url();
  const method = route.request().method();
  if (url.includes("/rest/v1/purchases_flat")) return route.fulfill(json(flat));
  if (url.includes("/rest/v1/suppliers")) {
    // PostgREST-shaped: honor name_norm filters + vnd.pgrst.object Accept
    const req = route.request();
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    const u = new URL(url);
    const normEq = u.searchParams.get("name_norm");
    if (normEq !== null) {
      const val = (normEq.startsWith("eq.") ? normEq.slice(3) : normEq).toUpperCase();
      const hit = suppliers.find((s) => s.name_norm.toUpperCase() === val) ?? null;
      return route.fulfill(json(wantsObject ? hit : hit ? [hit] : []));
    }
    return route.fulfill(json(suppliers));
  }
  if (url.includes("/rest/v1/categories"))
    return route.fulfill(json([{ id: 3, name: "PVC Pipes & Fittings", sort: 1, unit: "pc" },
                               { id: 4, name: "Cement", sort: 2, unit: "bag" }]));
  if (url.includes("/rest/v1/projects")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/materials")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/profiles")) return route.fulfill(json([{ role: "owner" }]));
  if (url.includes("/rest/v1/import_batches")) return route.fulfill(json([]));
  if (url.includes("/auth/v1/user"))
    return route.fulfill(json({ id: "11111111-1111-1111-1111-111111111111",
                                email: "owner@roro.ph", aud: "authenticated", role: "authenticated" }));
  return route.fulfill(json([]));
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1124, height: 800 }, acceptDownloads: true });
await ctx.route(`https://${REF}.supabase.co/**`, routeSupabase);
const page = await ctx.newPage();
await page.addInitScript((ref) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
    access_token: "fake-access", refresh_token: "fake-refresh", token_type: "bearer",
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "11111111-1111-1111-1111-111111111111", email: "owner@roro.ph",
            aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
  }));
}, REF);

let up = false;
for (let i = 0; i < 40 && !up; i++) {
  try { await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 1500 }); up = true; }
  catch { await sleep(500); }
}
if (!up) { console.error("PREVIEW NOT UP"); process.exit(1); }
await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });

fs.mkdirSync("shots/exports", { recursive: true });
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 30000 }),
  page.click('button:has-text("Export (Excel)")'),
]);
await download.saveAs(OUT);

// ---- parse the produced workbook -------------------------------------------
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(await fs.promises.readFile(OUT));
const ws = wb.worksheets[0];

const results = [];
const ok = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);

ok("title PURCHASES sits in A1", ws.getCell("A1").value === "PURCHASES", String(ws.getCell("A1").value));

// the table: real Excel table with the blue Medium 9 style + row stripes.
// (exceljs's reader wraps the model in a Table instance under .table)
const tables = Object.values(ws.tables ?? {}).map((t) => t.table ?? t);
const tbl = tables[0];
ok("workbook contains a table named Purchases", tbl?.name === "Purchases",
  JSON.stringify(tables.map((t) => t.name)));
ok("table style is TableStyleMedium9 (Blue, Medium 9)",
  tbl?.style?.theme === "TableStyleMedium9", JSON.stringify(tbl?.style));
ok("row stripes on (banded blue rows)", tbl?.style?.showRowStripes === true);
ok("table spans A3:H7", tbl?.tableRef === "A3:H7", tbl?.tableRef);

// headers: row 3, capitalized + bold Arial 11 white (the style's blue shows)
const HEADERS = ["DATE", "INVOICE/RECEIPT", "SUPPLIER'S NAME", "PARTICULARS", "PROJECT",
                 "UNIT PRICE", "QUANTITY", "AMOUNT"];
const headerRow = ws.getRow(3);
const hVals = HEADERS.map((_, i) => headerRow.getCell(i + 1).value);
ok("headers capitalized exactly as the ledger", JSON.stringify(hVals) === JSON.stringify(HEADERS),
  JSON.stringify(hVals));
const hFont = headerRow.getCell(1).font;
ok("headers are bold Arial 11",
  hFont?.bold === true && hFont?.name === "Arial" && Number(hFont?.size) === 11,
  JSON.stringify(hFont));
ok("header text is white (on the style's blue header)",
  hFont?.color?.argb === "FFFFFFFF", JSON.stringify(hFont?.color));

// data: every line carries its own date / SI# / supplier — nothing blank
const local = (v) => {
  if (!(v instanceof Date)) return null;
  return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
};
const cell = (r, c) => ws.getRow(r).getCell(c);
const r4 = [local(cell(4, 1).value), cell(4, 2).value, cell(4, 3).value];
ok("line 1 carries date, SI#, supplier",
  r4[0] === "2026-09-10" && r4[1] === "SI# 292713" && r4[2] === "HARDWARE A", JSON.stringify(r4));
const r5 = [local(cell(5, 1).value), cell(5, 2).value, cell(5, 3).value];
const r6 = [local(cell(6, 1).value), cell(6, 2).value, cell(6, 3).value];
ok("continuation lines repeat the same date/SI#/supplier (no blanks)",
  JSON.stringify(r5) === JSON.stringify(["2026-09-10", "SI# 292713", "HARDWARE A"]) &&
  JSON.stringify(r6) === JSON.stringify(["2026-09-10", "SI# 292713", "HARDWARE A"]),
  `${JSON.stringify(r5)} / ${JSON.stringify(r6)}`);
const r7 = [local(cell(7, 1).value), cell(7, 2).value, cell(7, 3).value];
ok("the other receipt shows its own header (blank SI stays blank)",
  r7[0] === "2026-09-09" && r7[1] === "" && r7[2] === "CEMENT CO", JSON.stringify(r7));

// the Project column rides along on every line
const proj = (r) => String(cell(r, 5).value ?? "");
ok("every line carries its PROJECT",
  proj(4) === "MCDO" && proj(5) === "MCDO" && proj(6) === "MCDO" && proj(7) === "Talisay",
  JSON.stringify([proj(4), proj(5), proj(6), proj(7)]));

// data cells: Arial 11, dates/money formatted per cell
const dFont = cell(5, 4).font;
ok("data cells are Arial 11 (not bold)",
  dFont?.name === "Arial" && Number(dFont?.size) === 11 && !dFont?.bold,
  JSON.stringify(dFont));
ok("DATE cell is long-date formatted",
  String(cell(4, 1).numFmt ?? "").includes("dddd"), String(cell(4, 1).numFmt));
ok("AMOUNT cell uses the accounting format",
  String(cell(4, 8).numFmt ?? "").includes("#,##0.00"), String(cell(4, 8).numFmt));

// numbers land as numbers with the right values (price F, qty G, amount H)
ok("unit price / qty / amount are numbers",
  cell(4, 6).value === 374.8 && cell(4, 7).value === 3 && cell(4, 8).value === 1124.4,
  JSON.stringify([cell(4, 6).value, cell(4, 7).value, cell(4, 8).value]));

// money/date column formats survive via the column styles
const c1 = ws.getColumn(1), c6 = ws.getColumn(6);
ok("column widths kept", Math.abs((c1.width ?? 0) - 32.53) < 0.01 && Math.abs((c6.width ?? 0) - 18.13) < 0.01,
  JSON.stringify([c1.width, c6.width]));
ok("DATE column is long-date formatted",
  typeof c1.numFmt === "string" && c1.numFmt.includes("dddd"), String(c1.numFmt));
ok("UNIT PRICE / AMOUNT columns use the accounting format",
  typeof c6.numFmt === "string" && c6.numFmt.includes("#,##0.00"), String(c6.numFmt));

// nothing to the right of AMOUNT
const spill = ws.getRow(4).cellCount;
ok("nothing to the right of AMOUNT", spill <= 8, `row 4 has ${spill} cells`);

console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
