// Verifies the Google Sheets export from the app's side: clicks the app's own
// Export button (Purchases page toolbar), catches the POST to the export
// function (material-control-plans/api/sheets-export.js — its own check
// covers the sheet's layout/formatting), and checks the payload, the
// Supabase token, the sheet opening, and the result/error banners.
// Usage: npm run build && npx vite preview --port 4188 & node scripts/sheets-export-check.mjs
import { chromium } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";
const EXPORT_URL = "https://material-control-plans.vercel.app/api/sheets-export";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/OWNED/edit#gid=77";

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
const ctx = await browser.newContext({ viewport: { width: 1124, height: 800 } });
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


let reply = { status: 200, body: { url: SHEET_URL, rows: 4 } };
const posts = [];
await ctx.route(EXPORT_URL, (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: {
    "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS" } });
  posts.push({ auth: req.headers()["authorization"], body: JSON.parse(req.postData() ?? "{}") });
  return route.fulfill(json(reply.body, reply.status));
});
// the sheet itself opens in a new window (the desktop app hands it to the
// default browser) — don't actually load Google
await ctx.route("https://docs.google.com/**", (route) => route.fulfill({ status: 200, body: "sheet" }));

let up = false;
for (let i = 0; i < 40 && !up; i++) {
  try { await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 1500 }); up = true; }
  catch { await sleep(500); }
}
if (!up) { console.error("PREVIEW NOT UP"); process.exit(1); }
await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });

const results = [];
const ok = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);

const btn = page.locator('.page-actions button:has-text("Export (Google Sheets)")');
ok("toolbar button says Export (Google Sheets)", (await btn.count()) === 1);
ok("no Excel export left on the page", (await page.locator('button:has-text("Export (Excel)"), button:has-text("Export to Excel")').count()) === 0);

const [popup] = await Promise.all([
  ctx.waitForEvent("page", { timeout: 15000 }).catch(() => null),
  btn.click(),
]);
await page.waitForSelector(".banner.ok", { timeout: 10000 });
ok("one POST to the export function", posts.length === 1, String(posts.length));
ok("sent with the signed-in Supabase token", posts[0]?.auth === "Bearer fake-access", posts[0]?.auth);
const rows = posts[0]?.body.rows ?? [];
ok("all 4 ledger lines sent", rows.length === 4, String(rows.length));
const first = rows.find((r) => r.particulars_raw === "PVC TEE 3X3");
ok("a line carries date / SI# / supplier / project / numbers",
  first?.purchase_date === "2026-09-10" && first.si_no === "SI# 292713" && first.supplier === "HARDWARE A"
  && first.project_name === "MCDO" && first.unit_price === 374.8 && first.quantity === 3 && first.amount === 1124.4,
  JSON.stringify(first));
ok("blank SI# sent blank, project kept", rows.some((r) => r.si_no === "" && r.project_name === "Talisay"));
ok("the new sheet opens", popup?.url() === SHEET_URL, popup?.url());
await popup?.close();
const okText = await page.locator(".banner.ok").innerText();
ok("success banner with a link back to the sheet",
  /Exported 4 lines to Google Sheets/.test(okText)
  && (await page.locator(".banner.ok a").getAttribute("href")) === SHEET_URL, okText);

// server not configured → a clear message, no window
reply = { status: 501, body: { error: "not_configured" } };
await page.locator(".banner.ok button").click();
await btn.click();
await page.waitForSelector(".banner.err", { timeout: 10000 });
ok("unconfigured server → explains it", /isn't set up/.test(await page.locator(".banner.err").innerText()));

// sheet not shared with the service account
reply = { status: 422, body: { error: "not_shared" } };
await btn.click();
await page.waitForFunction(() => /share the export spreadsheet/.test(document.querySelector(".banner.err")?.textContent ?? ""), null, { timeout: 10000 }).catch(() => {});
ok("not shared → tells you to share it with the service account",
  /share the export spreadsheet/.test(await page.locator(".banner.err").innerText()));

console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
