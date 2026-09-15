// Verifies the SI# fixed-prefix box, the same-receipt ledger convention, and
// the Projects catalog — without real credentials: vite preview serves dist/,
// a fake session sits in localStorage, and every Supabase call is answered
// from fixtures below. Purchases POSTs/PATCHes, projects POSTs/DELETEs and
// search_materials calls are recorded and asserted.
import { chromium } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";

const purchasesWrites = []; // POST bodies + PATCH bodies
const projWrites = [];      // {kind, body|url}
const searchQs = [];
let projNextId = 3;

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

const projects = [
  { id: 1, name: "MCDO", name_norm: "MCDO", created_at: "2026-09-01T00:00:00Z" },
  { id: 2, name: "Talisay", name_norm: "TALISAY", created_at: "2026-09-01T00:00:00Z" },
];
const materials = [
  { id: 10, category_id: 3, brand: "MOLDEX", type: "PVC TEE", size_native: "3X3", degrees: null,
    unit: "pc", search_name: "MOLDEX PVC TEE 3X3", usage_count: 5 },
];
const teeHit = { id: 10, search_name: "MOLDEX PVC TEE 3X3", brand: "MOLDEX", type: "PVC TEE",
  size_native: "3X3", degrees: null, last_unit_price: 374.8 };
const suppliers = [
  { id: 1, name: "HARDWARE A", name_norm: "HARDWARE A" },
  { id: 2, name: "CEMENT CO", name_norm: "CEMENT CO" },
];

const json = (body, status = 200) => ({
  status,
  contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});

async function routeSupabase(route) {
  const url = route.request().url();
  const method = route.request().method();
  if (method === "POST" && url.includes("/rest/v1/purchases")) {
    purchasesWrites.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill(json([{ id: 901 }], 201));
  }
  if (method === "PATCH" && url.includes("/rest/v1/purchases")) {
    purchasesWrites.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill(json(null, 204));
  }
  if (url.includes("/rest/v1/projects")) {
    if (method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      projWrites.push({ kind: "insert", body });
      const norm = (body.name ?? "").toUpperCase();
      if (projects.some((p) => p.name_norm === norm)) {
        return route.fulfill(json({ code: "23505", message: "duplicate key" }, 409));
      }
      const row = { id: projNextId++, name: body.name, name_norm: norm, created_at: "2026-09-15T00:00:00Z" };
      projects.push(row); // the fixture list grows so the UI sees the new project
      return route.fulfill(json([row], 201));
    }
    if (method === "DELETE") {
      projWrites.push({ kind: "delete", url });
      return route.fulfill(json(null, 204));
    }
    return route.fulfill(json(projects));
  }
  if (url.includes("/rpc/search_materials")) {
    let q = "";
    try { q = JSON.parse(route.request().postData() ?? "{}").q ?? ""; } catch { /* bodyless */ }
    searchQs.push(q);
    return route.fulfill(json([teeHit]));
  }
  if (url.includes("/rest/v1/purchases_flat")) return route.fulfill(json(flat));
  if (url.includes("/rest/v1/categories"))
    return route.fulfill(json([{ id: 3, name: "PVC Pipes & Fittings", sort: 1, unit: "pc" },
                               { id: 4, name: "Cement", sort: 2, unit: "bag" }]));
  if (url.includes("/rest/v1/suppliers")) {
    // behave like PostgREST: honor name_norm=eq.<v> filters and the
    // vnd.pgrst.object Accept header (.single()/.maybeSingle() send it) —
    // ensureSupplier must get ONE row or null, never the whole list
    const req = route.request();
    const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
    if (method === "POST") {
      const body = JSON.parse(req.postData() ?? "{}");
      const norm = String(body.name ?? "").toUpperCase().replace(/\s+/g, " ").trim();
      let row = suppliers.find((s) => s.name_norm === norm);
      if (!row) {
        row = { id: suppliers.length + 1, name: body.name, name_norm: norm };
        suppliers.push(row);
      }
      return route.fulfill(json(wantsObject ? row : [row], 201));
    }
    const u = new URL(url);
    const normEq = u.searchParams.get("name_norm");
    if (normEq !== null) {
      const val = (normEq.startsWith("eq.") ? normEq.slice(3) : normEq).toUpperCase();
      const hit = suppliers.find((s) => s.name_norm.toUpperCase() === val) ?? null;
      return route.fulfill(json(wantsObject ? hit : hit ? [hit] : []));
    }
    return route.fulfill(json(suppliers));
  }
  if (url.includes("/rest/v1/materials")) return route.fulfill(json(materials));
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

let up = false;
for (let i = 0; i < 40 && !up; i++) {
  try { await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 1500 }); up = true; }
  catch { await sleep(500); }
}
if (!up) { console.error("PREVIEW NOT UP"); process.exit(1); }
await page.waitForSelector(".pp-draft", { timeout: 10000 });

const results = [];
const ok = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);

async function waitForWrite(arr, before) {
  for (let i = 0; i < 50 && arr.length === before; i++) await sleep(100);
}

/** Wait until the entry row's Add button is re-enabled (mutation fully done,
 *  draft reset committed) — filling fields too early races the reset. */
async function waitForIdle() {
  for (let i = 0; i < 50; i++) {
    const dis = await page.$eval(".pp-add", (b) => b.disabled).catch(() => true);
    if (!dis) { await sleep(150); return; }
    await sleep(100);
  }
}

// cell texts of the table row whose particulars contain `part`
function rowCells(part) {
  return [...document.querySelectorAll(".pp-table tbody tr")]
    .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()))
    .find((cells) => cells.some((c) => c.includes(part)));
}

// ---------- entry row: fixed SI# prefix, digits only -------------------------
{
  const pre = await page.textContent(".pp-draft .si-prefix");
  ok("entry row shows the fixed SI# prefix", pre === "SI#", pre);

  await page.fill(".pp-si input", "SI# 3003abc");
  const v = await page.inputValue(".pp-si input");
  ok("typed letters/# are stripped — digits only stay", v === "3003", v);

  await page.fill(".pp-sup input", "HARDWARE A");
  await page.fill(".pp-part input", "ASSORTED NAILS");
  await page.fill('.pp-draft input[placeholder="Unit Price"]', "50");
  let before = purchasesWrites.length;
  await page.click(".pp-add");
  await waitForWrite(purchasesWrites, before);
  await waitForIdle();
  const w1 = purchasesWrites[purchasesWrites.length - 1];
  ok("save wraps the digits — si_no = SI# 3003", w1?.si_no === "SI# 3003", JSON.stringify(w1?.si_no));
}

// ---------- same-receipt rule: blank SI + same day + same supplier ----------
{
  await page.fill(".pp-date", "2026-09-10"); // the fixture block's day
  await page.fill(".pp-si input", "");
  const siBeforeClick = await page.inputValue(".pp-si input");
  await page.fill(".pp-part input", "MORE NAILS");
  const siBeforeClick2 = await page.inputValue(".pp-si input");
  await page.fill('.pp-draft input[placeholder="Unit Price"]', "60");
  let before = purchasesWrites.length;
  await page.click(".pp-add");
  await waitForWrite(purchasesWrites, before);
  await waitForIdle();
  const w2 = purchasesWrites[purchasesWrites.length - 1];
  ok("blank SI on the same day+supplier saves receipt_quality ok (NOT no-invoice)",
    w2?.si_no === "" && w2?.receipt_quality === "ok",
    JSON.stringify([siBeforeClick, siBeforeClick2, w2]));

  await page.fill(".pp-date", "2026-09-12"); // no block that day
  await page.fill(".pp-part input", "ODD NAILS");
  await page.fill('.pp-draft input[placeholder="Unit Price"]', "70");
  before = purchasesWrites.length;
  await page.click(".pp-add");
  await waitForWrite(purchasesWrites, before);
  await waitForIdle();
  const w3 = purchasesWrites[purchasesWrites.length - 1];
  ok("blank SI with no matching block stays no-invoice",
    w3?.si_no === "" && w3?.receipt_quality === "no-invoice",
    JSON.stringify([w3?.si_no, w3?.receipt_quality]));
}

// ---------- table: same-receipt rows show blank date/SI#/supplier ------------
{
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });
  const head = await page.evaluate(rowCells, "PVC TEE 3X3");
  ok("first line of the receipt shows date + SI# + supplier",
    head?.[0] === "2026-09-10" && head?.[1] === "SI# 292713" && head?.[2] === "HARDWARE A",
    JSON.stringify(head?.slice(0, 3)));
  const mid = await page.evaluate(rowCells, "PVC ELBOW 3X90");
  ok("second line repeats the same date + SI# + supplier (no blanks)",
    mid?.[0] === "2026-09-10" && mid?.[1] === "SI# 292713" && mid?.[2] === "HARDWARE A",
    JSON.stringify(mid?.slice(0, 3)));
  const last = await page.evaluate(rowCells, "PVC PIPE 4");
  ok("third line repeats them too",
    last?.[0] === "2026-09-10" && last?.[1] === "SI# 292713" && last?.[2] === "HARDWARE A",
    JSON.stringify(last?.slice(0, 3)));
  const other = await page.evaluate(rowCells, "ASSORTED NAILS");
  ok("a different receipt still shows its header (blank SI shows —)",
    other?.[0] === "2026-09-09" && other?.[1] === "—" && other?.[2] === "CEMENT CO",
    JSON.stringify(other?.slice(0, 3)));
}

// ---------- edit row: prefix stripped on load, re-wrapped on save ------------
{
  // pin the row by INDEX — once it enters edit mode its text lives in input
  // values, which text-based locators can't see
  const idx = await page.evaluate((part) => {
    const trs = [...document.querySelectorAll(".pp-table tbody tr")];
    return trs.findIndex((tr) => tr.textContent.includes(part));
  }, "PVC TEE 3X3");
  const tr = page.locator(".pp-table tbody tr").nth(idx);
  await tr.locator(".iconbtn").first().click();
  const v = await page.inputValue(".pp-table tr.editing .si-box input");
  ok("edit box loads digits only (prefix stripped)", v === "292713", v);
  await page.fill(".pp-table tr.editing .si-box input", "292799");
  let before = purchasesWrites.length;
  await tr.locator("button.icon.primary").click();
  await waitForWrite(purchasesWrites, before);
  const patch = purchasesWrites.slice(before).find((b) => b.si_no !== undefined);
  ok("edit save re-wraps the digits — si_no = SI# 292799",
    patch?.si_no === "SI# 292799", JSON.stringify(patch?.si_no));
  await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });
}

// ---------- predictive Project box + auto-cataloging -------------------------
{
  await page.fill(".pp-sup input", "HARDWARE A"); // the draft reset after the reload
  await page.click(".pp-proj input");
  await page.waitForSelector(".pp-proj .dropdown .o-name", { timeout: 4000 });
  const opts = await page.$$eval(".pp-proj .dropdown .o-name", (els) => els.map((e) => e.textContent));
  ok("Project box lists catalog + ledger projects (MCDO, Talisay)",
    opts.join("|") === "MCDO|Talisay", opts.join("|"));
  await page.fill(".pp-proj input", "tal");
  await page.waitForTimeout(200);
  const filtered = await page.$$eval(".pp-proj .dropdown .o-name", (els) => els.map((e) => e.textContent));
  ok("typing filters the project suggestions", filtered.join("|") === "Talisay", filtered.join("|"));
  await page.click(".pp-proj .dropdown .option");
  const pv = await page.inputValue(".pp-proj input");
  ok("picking fills the exact project", pv === "Talisay", pv);

  await page.fill(".pp-part input", "ASSORTED NAILS");
  await page.fill('.pp-draft input[placeholder="Unit Price"]', "50");
  const beforeP = purchasesWrites.length;
  const beforeJ = projWrites.length;
  await page.click(".pp-add");
  await waitForWrite(purchasesWrites, beforeP);
  await waitForIdle();
  const w = purchasesWrites[purchasesWrites.length - 1];
  ok("row saves with the picked project", w?.project_name === "Talisay", JSON.stringify(w?.project_name));
  for (let i = 0; i < 50 && projWrites.length === beforeJ; i++) await sleep(100);
  const ins = projWrites.slice(beforeJ).find((x) => x.kind === "insert");
  ok("a used project is auto-catalogued (dup insert is swallowed, save still lands)",
    ins?.body?.name === "Talisay" && w?.project_name === "Talisay", JSON.stringify(ins?.body));
}

// ---------- Read-Only: same receipt-blanking ---------------------------------
{
  await page.click('a[href="#/readonly"]');
  await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });
  const mid = await page.evaluate(rowCells, "PVC ELBOW 3X90");
  ok("Read-Only repeats date + SI# + supplier on every line too",
    mid?.[0] === "2026-09-10" && mid?.[1] === "SI# 292713" && mid?.[2] === "HARDWARE A",
    JSON.stringify(mid?.slice(0, 3)));
}

// ---------- Particulars tab: the Projects card -------------------------------
{
  await page.click('a[href="#/materials"]');
  await page.waitForSelector('.card-head:has-text("Projects")', { timeout: 10000 });

  await page.fill('input[placeholder="e.g. MCDO"]', "AYALA");
  await page.click('button:has-text("Add project")');
  for (let i = 0; i < 50 && !projWrites.some((w) => w.kind === "insert" && w.body?.name === "AYALA"); i++) await sleep(100);
  ok("Add project inserts into the projects catalog",
    projWrites.some((w) => w.kind === "insert" && w.body?.name === "AYALA"),
    JSON.stringify(projWrites));
  await page.waitForSelector('.card:has-text("Projects") table tbody tr', { timeout: 10000 });
  const names = await page.$$eval('.card:has-text("Projects") table tbody tr td:first-child',
    (tds) => tds.map((td) => td.textContent.trim()));
  ok("project list shows the new project + ledger names",
    names.join("|") === "AYALA|MCDO|Talisay", names.join("|"));

  page.on("dialog", (d) => void d.accept());
  await page.click('.card:has-text("Projects") tbody tr:first-child .iconbtn');
  for (let i = 0; i < 50 && !projWrites.some((w) => w.kind === "delete"); i++) await sleep(100);
  const del = projWrites.find((w) => w.kind === "delete");
  ok("trash removes the project (DELETE id=eq.3 for AYALA)",
    del?.url?.includes("/rest/v1/projects?id=eq.3") === true, del?.url);
}

// ---------- /entry: the invoice editor's SI# + Project ------------------------
{
  await page.goto(`${BASE}/#/entry`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".line-box", { timeout: 10000 });
  const pre = await page.textContent(".card .si-box .si-prefix");
  ok("invoice editor shows the fixed SI# prefix too", pre === "SI#", pre);
  await page.fill('input[list="supplier-list"]', "HARDWARE A");
  await page.fill(".card .si-box input", "292713");
  await page.fill('.card .line-box .predictive input', "PIPE");
  await page.fill('.line-box input[placeholder="0.00"]', "100");
  await page.fill('.line-box input[placeholder="1"]', "2");
  await page.fill('label.field:has-text("Project name") input', "MCDO");
  const before = purchasesWrites.length;
  await page.click('.savebar button:has-text("Save invoice")');
  await waitForWrite(purchasesWrites, before);
  const body = purchasesWrites[purchasesWrites.length - 1];
  const row = Array.isArray(body) ? body[0] : body;
  ok("invoice block saves si_no = SI# 292713 with the project",
    row?.si_no === "SI# 292713" && row?.project_name === "MCDO",
    JSON.stringify([row?.si_no, row?.project_name]));
}

await page.locator(".card").first().screenshot({ path: "shots/si-projects.png" });
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
