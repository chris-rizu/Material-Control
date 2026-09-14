// Verifies the All Projects dropdown on Purchases + Read-Only without real
// credentials: vite preview serves dist/, a fake session sits in localStorage,
// and every Supabase call is answered from fixtures below.
import { chromium } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";

const flat = [
  { id: 201, purchase_date: "2026-09-10", si_no: "SI# 1001", supplier: "HARDWARE A", supplier_id: 1,
    category: "PVC Pipes & Fittings", category_id: 3, material: "MOLDEX PVC TEE 3X3", material_id: 10,
    particulars_raw: "MOLDEX PVC TEE 3X3", project_name: "MCDO", unit_price: 374.8, quantity: 3,
    amount: 1124.4, amount_source: "computed", receipt_quality: "ok", line_seq: 1,
    material_brand: "MOLDEX", material_type: "PVC TEE", material_model_ver: null,
    material_size_native: "3X3", material_degrees: null, created_at: "2026-09-10T02:00:00Z" },
  { id: 202, purchase_date: "2026-09-08", si_no: "SI# 1002", supplier: "HARDWARE A", supplier_id: 1,
    category: "PVC Pipes & Fittings", category_id: 3, material: "MOLDEX PVC ELBOW 3X90", material_id: 11,
    particulars_raw: "MOLDEX PVC ELBOW 3X90", project_name: " mcdo", unit_price: 350, quantity: 1,
    amount: 350, amount_source: "computed", receipt_quality: "ok", line_seq: 1,
    material_brand: "MOLDEX", material_type: "PVC ELBOW", material_model_ver: null,
    material_size_native: "3X90", material_degrees: "90", created_at: "2026-09-08T02:00:00Z" },
  { id: 203, purchase_date: "2026-09-05", si_no: "SI# 1003", supplier: "CEMENT CO", supplier_id: 2,
    category: "Cement", category_id: 4, material: "REPUBLIC CEMENT 40KG", material_id: 12,
    particulars_raw: "REPUBLIC CEMENT 40KG", project_name: "Talisay", unit_price: 240, quantity: 10,
    amount: 2400, amount_source: "computed", receipt_quality: "ok", line_seq: 1,
    material_brand: "REPUBLIC", material_type: "CEMENT", material_model_ver: null,
    material_size_native: "40KG", material_degrees: null, created_at: "2026-09-05T02:00:00Z" },
  { id: 204, purchase_date: "2026-09-01", si_no: "", supplier: "CEMENT CO", supplier_id: 2,
    category: "Cement", category_id: 4, material: null, material_id: null,
    particulars_raw: "ASSORTED NAILS", project_name: "", unit_price: 50, quantity: 2,
    amount: 100, amount_source: "manual", receipt_quality: "no-invoice", line_seq: 1,
    material_brand: null, material_type: null, material_model_ver: null,
    material_size_native: null, material_degrees: null, created_at: "2026-09-01T02:00:00Z" },
];

const json = (body, status = 200) => ({
  status,
  contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});

async function routeSupabase(route) {
  const url = route.request().url();
  if (url.includes("/rest/v1/purchases_flat")) return route.fulfill(json(flat));
  if (url.includes("/rest/v1/categories"))
    return route.fulfill(json([{ id: 3, name: "PVC Pipes & Fittings", sort: 1, unit: "pc" },
                               { id: 4, name: "Cement", sort: 2, unit: "bag" }]));
  if (url.includes("/rest/v1/suppliers"))
    return route.fulfill(json([{ id: 1, name: "HARDWARE A" }, { id: 2, name: "CEMENT CO" }]));
  if (url.includes("/rest/v1/profiles")) return route.fulfill(json([{ role: "owner" }]));
  if (url.includes("/rest/v1/import_batches")) return route.fulfill(json([]));
  if (url.includes("/auth/v1/user"))
    return route.fulfill(json({ id: "11111111-1111-1111-1111-111111111111",
                                email: "owner@roro.ph", aud: "authenticated", role: "authenticated" }));
  if (url.includes("/auth/v1/token"))
    return route.fulfill(json({ error: "no_refresh" }), 400);
  return route.fulfill(json([]));
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1124, height: 800 } }); // ≤1280 = the normal layout
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

// wait for vite preview
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
const projCells = () =>
  [...document.querySelectorAll(".pp-table tbody tr")].map((tr) =>
    tr.querySelector("td:nth-child(5)")?.textContent.trim().toUpperCase());
// project cells compared uppercased — the table shows each project AS TYPED
// ("mcdo" stays "mcdo"), only the filter is case-insensitive

// ---------- Purchases ----------
{
  const opts = await page.$$eval(".pp-toolbar select", (sels) =>
    sels.map((s) => [...s.options].map((o) => o.value)));
  const allProjects = await page.$$eval(".pp-toolbar select", (sels) =>
    sels.map((s) => s.options[0].textContent));
  ok("Purchases toolbar has 4 dropdowns", opts.length === 4, JSON.stringify(allProjects));
  ok("project dropdown lists distinct names (case-merged, blanks out, sorted)",
    JSON.stringify(opts[1]) === JSON.stringify(["", "MCDO", "Talisay"]), JSON.stringify(opts[1]));
  ok("first options read All …", JSON.stringify(allProjects) ===
    JSON.stringify(["All Suppliers", "All Projects", "All Statuses", "All Categories"]));

  await page.selectOption(".pp-toolbar select >> nth=1", "MCDO");
  let projs = await page.evaluate(projCells);
  ok("MCDO filter keeps both MCDO rows (case-insensitive)", projs.join(",") === "MCDO,MCDO",
    projs.join(","));
  let foot = await page.textContent(".pp-foot");
  ok("footer says filtered + 2 items", foot.includes("(filtered)") && foot.includes("2 items"), foot.trim());

  await page.selectOption(".pp-toolbar select >> nth=1", "Talisay");
  projs = await page.evaluate(projCells);
  ok("Talisay filter leaves 1 row", projs.join(",") === "TALISAY", projs.join(","));

  await page.fill(".searchbar input", "CEMENT");
  projs = await page.evaluate(projCells);
  ok("project + search combine (CEMENT under Talisay → 1 row)", projs.join(",") === "TALISAY",
    projs.join(","));

  await page.click(".pp-clear");
  const vals = await page.$$eval(".pp-toolbar select", (sels) => sels.map((s) => s.value));
  projs = await page.evaluate(projCells);
  ok("Clear resets every dropdown (4 rows back)", vals.every((v) => v === "") && projs.length === 4,
    `selects=${vals.join("|")} rows=${projs.length}`);

  // predictive search: type part of an item, get grouped suggestions, picking
  // one fills the box with the exact value (assumption) and filters the table
  await page.click(".searchbar input");
  await page.fill(".searchbar input", "MOL");
  await page.waitForSelector(".searchbar .dropdown .o-name", { timeout: 4000 });
  const sugg = await page.$$eval(".searchbar .dropdown .o-name", (els) => els.map((e) => e.textContent));
  ok("search suggests matching items while typing",
    sugg.join("|") === "MOLDEX PVC TEE 3X3|MOLDEX PVC ELBOW 3X90", sugg.join("|"));
  const heads = await page.$$eval(".searchbar .dropdown .dd-head", (els) => els.map((e) => e.textContent));
  ok("suggestions are grouped (Items)", heads.join("|") === "Items", heads.join("|"));
  await page.click(".searchbar .dropdown .option");
  const sv = await page.inputValue(".searchbar input");
  ok("picking a suggestion fills the exact value", sv === "MOLDEX PVC TEE 3X3", sv);
  projs = await page.evaluate(projCells);
  ok("assumed value filters the table (1 MOLDEX TEE row)",
    projs.length === 1 && sv === "MOLDEX PVC TEE 3X3", `rows=${projs.length}`);
  await page.click(".pp-clear");
}

// ---------- Read-Only (click the sidebar link — same engine as Purchases) ----------
await page.click('a[href="#/readonly"]');
await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });
{
  const opts = await page.$$eval(".pp-toolbar select", (sels) =>
    sels.map((s) => [...s.options].map((o) => o.value)));
  const first = await page.$$eval(".pp-toolbar select", (sels) =>
    sels.map((s) => s.options[0].textContent));
  ok("Read-Only toolbar has the same 4 filter dropdowns as Purchases",
    opts.length === 4 &&
    JSON.stringify(first) === JSON.stringify(["All Suppliers", "All Projects", "All Statuses", "All Categories"]),
    JSON.stringify(first));
  ok("Read-Only has the date range + Clear too",
    !!(await page.$(".pp-toolbar input[type=date]")) && !!(await page.$(".pp-clear")));
  const ropts = await page.$$eval(".pp-toolbar select", (sels) =>
    sels[1] ? [...sels[1].options].map((o) => o.value) : []);
  ok("Read-Only dropdown lists the same distinct names",
    JSON.stringify(ropts) === JSON.stringify(["", "MCDO", "Talisay"]), JSON.stringify(ropts));

  await page.selectOption(".pp-toolbar select >> nth=1", "MCDO");
  let projs = await page.evaluate(projCells);
  ok("Read-Only MCDO filter → 2 rows", projs.join(",") === "MCDO,MCDO", projs.join(","));

  // status + supplier + date range — same engine, same results as Purchases
  await page.click(".pp-clear");
  await page.selectOption(".pp-toolbar select >> nth=2", "receipt");
  let n = await page.$$eval(".pp-table tbody tr", (tr) => tr.length);
  ok("Read-Only status filter (receipt-rounded → the manual row)", n === 1, `rows=${n}`);

  await page.click(".pp-clear");
  await page.selectOption(".pp-toolbar select >> nth=0", "2");
  n = await page.$$eval(".pp-table tbody tr", (tr) => tr.length);
  ok("Read-Only supplier filter (CEMENT CO → 2 rows)", n === 2, `rows=${n}`);

  await page.click(".pp-clear");
  await page.fill(".pp-toolbar input[type=date] >> nth=0", "2026-09-05");
  n = await page.$$eval(".pp-table tbody tr", (tr) => tr.length);
  ok("Read-Only date-range filter (from 09-05 → 3 rows)", n === 3, `rows=${n}`);
  await page.click(".pp-clear");

  // predictive search on Read-Only too
  await page.fill(".searchbar input", "TAL");
  await page.waitForSelector(".searchbar .dropdown .o-name", { timeout: 4000 });
  const sugg = await page.$$eval(".searchbar .dropdown .o-name", (els) => els.map((e) => e.textContent));
  ok("Read-Only search suggests matching projects",
    sugg.join("|") === "Talisay", sugg.join("|"));
  await page.click(".searchbar .dropdown .option");
  const sv = await page.inputValue(".searchbar input");
  const n2 = await page.$$eval(".pp-table tbody tr", (tr) => tr.length);
  ok("Read-Only assumed search filters (Talisay → 1 row)",
    sv === "Talisay" && n2 === 1, `search="${sv}" rows=${n2}`);
}

await page.locator(".pp-card").first().screenshot({ path: "shots/project-filter-purchases.png" });
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
