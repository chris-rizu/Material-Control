// Verifies the receipt-photo feature end to end against the mocked DB:
//   Receipts tab — upload a real photo (downscaled to JPEG client-side),
//   filed under date + SI# + supplier; list + thumbnails from the photo cache.
//   Purchases ledger — SI# click opens the filed photo directly, already
//   preloaded into the receipt photo cache (or the popover with
//   "No receipt found" + Add receipt, which jumps to /receipts prefilled; a
//   near-miss photo filed under the wrong date/supplier/SI# is named + viewable,
//   and "Use this photo for this invoice" re-keys it in place via PATCH);
//   the viewer modal shows the actual photo. Blank-SI same-receipt blocks
//   share the photo keyed to date + supplier. Delete removes row + object and
//   the ledger popover falls back to "No receipt found".
// Storage (upload/sign/remove) and receipts REST calls are recorded + asserted.
import { chromium } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PHOTO_1 = join(ROOT, "receipts", "1.png");
const PHOTO_2 = join(ROOT, "receipts", "2.png");
const PHOTO_3 = join(ROOT, "receipts", "3.png");

// 1x1 PNG served in place of the stored photo (the client only needs a
// decodable image so naturalWidth proves the signed URL rendered)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// ---- mock database ----------------------------------------------------------
const suppliers = [
  { id: 1, name: "HARDWARE A", name_norm: "HARDWARE A" },
  { id: 2, name: "CEMENT CO", name_norm: "CEMENT CO" },
];
const flat = [
  flatRow(101, "2026-09-10", "SI# 1001", 1, "MOLDEX PVC TEE 3X3", "PVC Pipes & Fittings"),
  flatRow(102, "2026-09-10", "SI# 1001", 1, "MOLDEX PVC ELBOW 3X90", "PVC Pipes & Fittings"),
  flatRow(103, "2026-09-11", "", 2, "DIESEL (FUEL)", "Fuel & Oil"), // blank SI = same-receipt block
  // the xlsx ledger keeps leading zeros ("SI# 002144") while the SI box stores
  // plain digits — matching must pair them through the canonical key
  flatRow(104, "2026-09-12", "SI# 002144", 1, "MOLDEX PVC PIPE 2IN", "PVC Pipes & Fittings"),
  // near-miss rows: a photo filed under the WRONG supplier/date (105) and a
  // same-block photo without the SI# (106) must surface in the popover instead
  // of silently reading as "no receipt"
  flatRow(105, "2026-09-15", "SI# 2144", 2, "MOLDEX PVC ELBOW 2X45", "PVC Pipes & Fittings"),
  flatRow(106, "2026-09-11", "SI# 7777", 2, "MOLDEX PVC CAP 2IN", "PVC Pipes & Fittings"),
];
function flatRow(id, date, siNo, supplierId, material, category) {
  const sup = suppliers.find((s) => s.id === supplierId);
  return { id, purchase_date: date, si_no: siNo, supplier: sup.name, supplier_id: supplierId,
    category, category_id: 3, material, material_id: 10, material_brand: null,
    material_type: null, material_model_ver: null, material_size_native: null, material_degrees: null,
    particulars_raw: material, attributes: {}, unit_price: 100, quantity: 1, amount: 100,
    amount_source: "computed", receipt_quality: "ok", line_seq: 0, notes: "",
    created_at: `${date}T02:00:00Z`, project_name: "" };
}

let receiptSeq = 0;
const receipts = []; // filled by the upload under test
const storedObjects = new Set(); // paths uploaded to the mock bucket
const writes = []; // every mutating call { method, path, body }
const downloads = []; // photo downloads through the cache (GET /object/receipts/…)

const json = (body, status = 200) => ({
  status, contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});
const png = () => ({
  status: 200, contentType: "image/png",
  headers: { "access-control-allow-origin": "*" },
  body: TINY_PNG,
});

async function routeSupabase(route) {
  const req = route.request();
  const url = req.url();
  const method = req.method();
  const u = new URL(url);
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  const body = () => { try { return JSON.parse(req.postData() ?? "null"); } catch { return null; } };
  const eqParam = (key) => {
    const v = u.searchParams.get(key);
    return v !== null && v.startsWith("eq.") ? v.slice(3) : v;
  };

  if (method !== "GET" && !url.includes("/auth/"))
    writes.push({ method, path: u.pathname + (u.search || ""), body: body() });

  if (url.includes("/auth/v1/user"))
    return route.fulfill(json({ id: "11111111-1111-1111-1111-111111111111",
                                email: "owner@roro.ph", aud: "authenticated", role: "authenticated" }));
  if (url.includes("/rpc/search_materials")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/profiles")) return route.fulfill(json([{ role: "owner" }]));
  if (url.includes("/rest/v1/import_batches")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/purchases_flat")) return route.fulfill(json([...flat]));
  if (url.includes("/rest/v1/purchases")) return route.fulfill(json([{}]), 201);
  if (url.includes("/rest/v1/categories")) return route.fulfill(json([
    { id: 3, name: "PVC Pipes & Fittings", unit: "pc", sort: 1, attribute_template: [] },
    { id: 6, name: "Fuel & Oil", unit: "L", sort: 2, attribute_template: [] },
  ]));
  if (url.includes("/rest/v1/materials")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/material_aliases")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/projects")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/suppliers")) {
    if (method === "GET") {
      const normEq = u.searchParams.get("name_norm");
      if (normEq !== null) {
        const val = normEq.startsWith("eq.") ? normEq.slice(3) : normEq;
        const hit = suppliers.find((s) => s.name_norm === val) ?? null;
        return route.fulfill(json(wantsObject ? hit : hit ? [hit] : []));
      }
      return route.fulfill(json([...suppliers]));
    }
    return route.fulfill(json([{}]), 201);
  }

  if (url.includes("/rest/v1/receipts")) {
    if (method === "POST") {
      const row = { id: ++receiptSeq, created_at: new Date().toISOString(), ...body() };
      receipts.push(row);
      return route.fulfill(json(wantsObject ? row : [row]), 201);
    }
    if (method === "DELETE") {
      const id = Number(eqParam("id"));
      const i = receipts.findIndex((r) => r.id === id);
      if (i >= 0) receipts.splice(i, 1);
      return route.fulfill({ status: 204 });
    }
    if (method === "PATCH") {
      // refileReceipt: update().eq(id).select("id") — apply and echo the id
      const row = receipts.find((r) => r.id === Number(eqParam("id")));
      if (row) Object.assign(row, body());
      return route.fulfill(json(row ? [{ id: row.id }] : []));
    }
    if (method === "GET") {
      // findReceiptRow sends block filters; the list query sends none
      if (u.searchParams.get("purchase_date") === null) return route.fulfill(json([...receipts]));
      // block lookup: purchase_date + si_no + supplier_id (or is.null)
      const hit = receipts.find((r) =>
        (eqParam("purchase_date") === null || r.purchase_date === eqParam("purchase_date")) &&
        (eqParam("si_no") === null || r.si_no === eqParam("si_no")) &&
        (u.searchParams.get("supplier_id") === null
          || (u.searchParams.get("supplier_id") === "is.null" ? r.supplier_id == null
                                                              : String(r.supplier_id) === eqParam("supplier_id"))));
      return route.fulfill(json(wantsObject ? hit ?? null : hit ? [hit] : []));
    }
    return route.fulfill(json([...receipts]));
  }

  // ---- storage: /storage/v1/... ---------------------------------------------
  if (url.includes("/storage/v1/object/receipts/")) {
    const path = decodeURIComponent(u.pathname.split("/object/receipts/")[1]);
    if (method === "POST") { storedObjects.add(path); return route.fulfill(json({ Key: `receipts/${path}` })); }
    if (method === "DELETE") { storedObjects.delete(path); return route.fulfill(json([])); }
    // authenticated download (the receipt photo cache): serves the bytes
    if (method === "GET") { downloads.push(path); return route.fulfill(png()); }
  }
  if (url.includes("/storage/v1/object/sign/receipts/") && method === "GET") {
    return route.fulfill(png()); // the signed URL itself serves the bytes
  }
  if (url.includes("/storage/v1/object/sign/receipts") && method === "POST") {
    const signOne = (p) => ({ error: null, path: p, signedURL: `/object/sign/receipts/${p}?token=fake` });
    if (u.pathname.endsWith("/object/sign/receipts")) {
      const b = body();
      return route.fulfill(json((b?.paths ?? []).map(signOne)));
    }
    const p = decodeURIComponent(u.pathname.split("/object/sign/receipts/")[1]);
    return route.fulfill(json({ signedURL: `/object/sign/receipts/${p}?token=fake` }));
  }

  return route.fulfill(json([]));
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1124, height: 800 } });
await ctx.route(`https://${REF}.supabase.co/**`, routeSupabase);
const page = await ctx.newPage();
page.on("dialog", (d) => void d.accept());
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
  try { await page.goto(BASE + "/#/receipts", { waitUntil: "domcontentloaded", timeout: 1500 }); up = true; }
  catch { await sleep(500); }
}
if (!up) { console.error("PREVIEW NOT UP"); process.exit(1); }
await page.waitForSelector('h1:text-is("Receipts")', { timeout: 10000 });

const results = [];
const ok = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
const writesSince = async (n) => {
  for (let i = 0; i < 80 && writes.length <= n; i++) await sleep(100);
  return writes.slice(n);
};

// ---- Receipts tab: nav + empty state ------------------------------------------
ok("nav has a Receipts item under Catalog",
  (await page.locator('.sidebar .nav-item[title="Receipts"]').count()) === 1);
ok("empty state before any upload",
  (await page.locator(".empty .e-title").textContent())?.includes("No receipt photos yet") === true);

// ---- upload receipt 1: 2026-09-10 · SI# 1001 · HARDWARE A ----------------------
await page.locator('.rc-field:has-text("Invoice date") input').fill("2026-09-10");
await page.locator(".rc-field:has-text('SI#') .si-box input").fill("1001");
await page.locator('.rc-field:has-text("Supplier") select').selectOption({ label: "HARDWARE A" });
await page.locator('input[type="file"]').setInputFiles(PHOTO_1);
ok("chosen photo previews with its file name",
  (await page.locator(".rc-thumb").count()) === 1 &&
  (await page.locator(".rc-file").textContent())?.includes("1.png") === true);

let n0 = writes.length;
await page.locator('button:has-text("Add receipt")').click();
await page.waitForSelector(".banner.ok", { timeout: 15000 });
const ws = await writesSince(n0);
const upload = ws.find((w) => w.method === "POST" && w.path.includes("/storage/v1/object/receipts/"));
const restPost = ws.find((w) => w.method === "POST" && w.path.includes("/rest/v1/receipts"));
ok("photo uploaded to the receipts bucket as JPEG (downscaled)",
  upload !== undefined && upload.path.includes("/storage/v1/object/receipts/2026-09-10/si-1001_1_"),
  upload?.path ?? "no upload call");
ok("receipt row filed under date + SI# + supplier",
  restPost !== undefined &&
  restPost.body?.purchase_date === "2026-09-10" &&
  restPost.body?.si_no === "SI# 1001" &&
  restPost.body?.supplier_id === 1 &&
  restPost.body?.mime_type === "image/jpeg" &&
  Number(restPost.body?.file_size ?? 0) > 0,
  JSON.stringify(restPost?.body ?? {}));
ok("success banner confirms the upload",
  (await page.locator(".banner.ok").textContent())?.includes("Receipt photo added for 2026-09-10 · SI# 1001") === true,
  await page.locator(".banner.ok").textContent().catch(() => ""));
await sleep(500);
ok("filed receipt listed with supplier",
  (await page.locator(".rc-table tbody tr").allTextContents())
    .some((t) => t.includes("2026-09-10") && t.includes("SI# 1001") && t.includes("HARDWARE A")));
const thumbLoaded = await page.locator(".rc-thumb-sm").evaluateAll(
  (imgs) => imgs.length > 0 && imgs.every((i) => i.naturalWidth > 0));
ok("thumbnail renders from the receipt photo cache", thumbLoaded);
ok("thumbnail photo downloaded once, no signing round-trip",
  downloads.filter((d) => d.startsWith("2026-09-10/si-1001_1_")).length === 1 &&
  !ws.some((w) => w.path.includes("/object/sign/receipts")),
  JSON.stringify(downloads));

// ---- ledger: SI# click → the photo, already loaded -----------------------------
await page.goto(BASE + "/#/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });
// the ledger is newest-first, so pin the SI# 1001 row by content —
// .first() would be the Sep 11 CEMENT CO block, which has no photo yet
const siRow = page.locator('.pp-table tbody tr:has-text("SI# 1001")').first();
const siLink = siRow.locator(".si-link");
ok("SI# renders as a link in the ledger", (await siLink.textContent())?.includes("SI# 1001") === true);

ok("SI# with a filed photo is marked as a photo link",
  (await siLink.getAttribute("class"))?.includes("has-photo") === true);
// the Receipts tab visit above cached the photo on this PC (IndexedDB), so the
// reloaded ledger must not download it again — and it must paint at once
const dl0 = downloads.length;
await sleep(600); // background preload window
await siLink.click();
const tClick = Date.now();
await page.waitForSelector(".modal-card .rv-img", { timeout: 10000 });
const openMs = Date.now() - tClick;
ok("one click on the SI# opens the photo directly (no menu step)",
  (await page.locator(".si-pop").count()) === 0 &&
  await page.locator(".modal-card .rv-img").evaluate((i) => i.naturalWidth > 0));
ok("photo is already there when clicked (cached, no spinner, no re-download)",
  openMs < 400 && (await page.locator(".rv-loading").count()) === 0 &&
  downloads.length === dl0,
  `opened in ${openMs}ms, downloads ${dl0}→${downloads.length}`);
ok("viewer caption carries the SI#",
  (await page.locator(".rv-cap b").textContent()) === "SI# 1001");
await page.locator(".rv-cap .iconbtn").click();
ok("viewer closes", (await page.locator(".modal-card").count()) === 0);

// ---- blank-SI same-receipt block: no photo → Add receipt jump, prefill ---------
// pin by particulars — the ledger now has TWO CEMENT CO rows (103 + 106)
const dashLink = page.locator('.pp-table tbody tr:has-text("DIESEL") .si-link');
await dashLink.click();
await page.waitForSelector(".si-pop", { timeout: 5000 });
ok("blank-SI popover says No receipt found + offers Add receipt",
  (await page.locator(".si-pop .sp-none").textContent())?.includes("No receipt found") === true &&
  (await page.locator('.si-pop button:has-text("Add receipt")').count()) === 1);
await page.locator('.si-pop button:has-text("Add receipt")').click();
await page.waitForSelector('h1:text-is("Receipts")', { timeout: 10000 });
ok("jump lands on Receipts with the block prefilled",
  (await page.locator('.rc-field:has-text("Invoice date") input').inputValue()) === "2026-09-11" &&
  (await page.locator(".rc-field:has-text('SI#') .si-box input").inputValue()) === "" &&
  (await page.locator('.rc-field:has-text("Supplier") select').inputValue()) === "2");

// ---- upload receipt 2: 2026-09-11 · blank SI · CEMENT CO -----------------------
await page.locator('input[type="file"]').setInputFiles(PHOTO_2);
n0 = writes.length;
await page.locator('button:has-text("Add receipt")').click();
await page.waitForSelector(".banner.ok", { timeout: 15000 });
await writesSince(n0);
const restPost2 = writes.slice(n0).find((w) => w.method === "POST" && w.path.includes("/rest/v1/receipts"));
const upload2 = writes.slice(n0).find((w) => w.method === "POST" && w.path.includes("/storage/v1/object/receipts/"));
ok("blank-SI receipt filed with empty si_no and its supplier",
  restPost2?.body?.si_no === "" && restPost2?.body?.supplier_id === 2 &&
  upload2?.path.includes("/2026-09-11/si-none_2_"),
  JSON.stringify([restPost2?.body?.si_no, upload2?.path ?? ""]));
await sleep(500);
ok("two receipts now listed",
  (await page.locator(".rc-table tbody tr").count()) === 2);

// ---- ledger: the same-receipt block now views its photo -------------------------
await page.goto(BASE + "/#/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });
await page.locator('.pp-table tbody tr:has-text("DIESEL") .si-link').click();
await page.waitForSelector(".modal-card .rv-img", { timeout: 10000 });
ok("same-receipt block opens its photo (matched by date + blank SI + supplier)",
  (await page.locator(".rv-cap").textContent())?.includes("2026-09-11") === true,
  await page.locator(".rv-cap").textContent().catch(() => ""));
await page.locator(".rv-cap .iconbtn").click();

// ---- delete receipt 1: row + stored object, ledger falls back -------------------
await page.goto(BASE + "/#/receipts", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".rc-table tbody tr", { timeout: 10000 });
n0 = writes.length;
await page.locator('.rc-table tbody tr:has-text("SI# 1001") button[title="Delete receipt photo"]').click();
await writesSince(n0);
const del = writes.slice(n0).find((w) => w.method === "DELETE" && w.path.includes("/rest/v1/receipts"));
const upPath = upload.path.replace("/storage/v1/object/receipts/", "");
// storage-js remove() bulk-DELETEs /object/receipts with {prefixes:[path]} —
// poll for it: writesSince already resolved on the REST delete above
let storDel;
for (let i = 0; i < 80 && !storDel; i++) {
  storDel = writes.slice(n0).find((w) => w.method === "DELETE" &&
    w.path.endsWith("/storage/v1/object/receipts") &&
    Array.isArray(w.body?.prefixes) && w.body.prefixes.includes(upPath));
  if (!storDel) await sleep(100);
}
ok("delete removes the receipt row and its stored photo",
  del?.path.includes("id=eq.1") === true && storDel !== undefined,
  JSON.stringify(writes.slice(n0).map((w) => w.method + " " + w.path)));
await sleep(500);
ok("list drops to one receipt",
  (await page.locator(".rc-table tbody tr").count()) === 1);

await page.goto(BASE + "/#/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });
// reopen the deleted SI# 1001 block by content (.first() is CEMENT CO, which has a photo)
await page.locator('.pp-table tbody tr:has-text("SI# 1001") .si-link').first().click();
await page.waitForSelector(".si-pop", { timeout: 5000 });
ok("deleted block's popover falls back to No receipt found",
  (await page.locator(".si-pop .sp-none").textContent())?.includes("No receipt found") === true,
  await page.locator(".si-pop").textContent().catch(() => ""));
await page.locator(".pop-backdrop").click(); // close the popover — its backdrop eats clicks

// ---- entry row: a staged photo files with Add -----------------------------------
const draftDate = await page.locator(".pp-draft .pp-date").inputValue();
await page.locator(".pp-draft .pp-si input").fill("555");
await page.locator('.pp-draft input[placeholder="Select supplier"]').fill("HARDWARE A");
await page.locator('.pp-draft input[placeholder="Particulars"]').fill("TEST NAIL 1IN");
await page.locator('.pp-draft input[placeholder="Unit Price"]').fill("10");
await page.locator(".pp-photo input[type=file]").setInputFiles(PHOTO_3);
ok("staged photo previews on the entry-row button",
  (await page.locator(".pp-photo.staged img").count()) === 1);

n0 = writes.length;
await page.locator(".pp-add").click();
let entryReceipt;
for (let i = 0; i < 100; i++) {
  entryReceipt = writes.slice(n0).find(
    (w) => w.method === "POST" && w.path.includes("/rest/v1/receipts") && w.body?.si_no === "SI# 555");
  if (entryReceipt) break;
  await sleep(100);
}
const entryLine = writes.slice(n0).find((w) => w.method === "POST" && w.path.includes("/rest/v1/purchases"));
const entryUpload = writes.slice(n0).find(
  (w) => w.method === "POST" && w.path.includes("/storage/v1/object/receipts/") &&
         w.path.includes(`/${draftDate}/si-555_1_`));
ok("line saved with the typed SI# + particulars",
  entryLine?.body?.si_no === "SI# 555" && entryLine?.body?.particulars_raw === "TEST NAIL 1IN",
  JSON.stringify(entryLine?.body ?? {}));
ok("staged photo filed against the line's block (date + SI# + supplier)",
  entryReceipt !== undefined &&
  entryReceipt.body?.purchase_date === draftDate &&
  entryReceipt.body?.supplier_id === 1 &&
  entryReceipt.body?.file_name === "3.png",
  JSON.stringify(entryReceipt?.body ?? {}));
ok("photo uploaded into the block's storage path", entryUpload !== undefined,
  writes.slice(n0).filter((w) => w.path.includes("/storage/")).map((w) => w.path).join(" | "));
await sleep(400);
ok("staging cleared after the save",
  (await page.locator(".pp-photo.staged").count()) === 0);

// ---- leading zeros: "2144" typed must pair with the ledger's "SI# 002144" ------
await page.goto(BASE + "/#/receipts", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".rc-form", { timeout: 10000 });
await page.locator('.rc-field:has-text("Invoice date") input').fill("2026-09-12");
await page.locator(".rc-field:has-text('SI#') .si-box input").fill("2144");
await page.locator('.rc-field:has-text("Supplier") select').selectOption({ label: "HARDWARE A" });
await page.locator('input[type="file"]').setInputFiles(PHOTO_3);
n0 = writes.length;
await page.locator('button:has-text("Add receipt")').click();
await page.waitForSelector(".banner.ok", { timeout: 15000 });
let zerosReceipt;
for (let i = 0; i < 100; i++) {
  zerosReceipt = writes.slice(n0).find(
    (w) => w.method === "POST" && w.path.includes("/rest/v1/receipts") && w.body?.si_no === "SI# 2144");
  if (zerosReceipt) break;
  await sleep(100);
}
ok("receipt stored canonically as typed (SI# 2144)", zerosReceipt !== undefined,
  JSON.stringify(writes.slice(n0).find((w) => w.path.includes("/rest/v1/receipts"))?.body?.si_no ?? ""));

await page.goto(BASE + "/#/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });
await page.locator('.pp-table tbody tr:has-text("SI# 002144") .si-link').first().click();
await page.waitForSelector(".modal-card .rv-img", { timeout: 10000 });
ok("typed 2144 matches the ledger's SI# 002144 (leading zeros ignored)",
  (await page.locator(".rv-cap b").textContent()) === "SI# 2144",
  await page.locator(".rv-cap").textContent().catch(() => ""));
await page.locator(".rv-cap .iconbtn").click();
await page.waitForSelector(".modal-card", { state: "detached", timeout: 5000 });

// ---- near-miss diagnostics: a misfiled photo must be VISIBLE, not silent --------
// row 105 (2026-09-15 · CEMENT CO, SI# 2144) — the SI# 2144 photo is filed under
// 2026-09-12 · HARDWARE A, so the popover must say exactly that
await page.locator('.pp-table tbody tr:has-text("2026-09-15") .si-link').click();
await page.waitForSelector(".si-pop", { timeout: 5000 });
ok("wrong-date/supplier popover: No receipt found + names the filed one",
  (await page.locator(".si-pop .sp-none").textContent())?.includes("No receipt found") === true &&
  (await page.locator(".si-pop .sp-hint").textContent())?.includes("2026-09-12 · HARDWARE A") === true &&
  (await page.locator(".si-pop .sp-hint").textContent())?.includes("different date or supplier") === true,
  await page.locator(".si-pop").textContent().catch(() => ""));
await page.locator('.si-pop button:has-text("View the filed photo")').click();
await page.waitForSelector(".modal-card .rv-img", { timeout: 10000 });
ok("near-miss photo opens from the popover",
  await page.locator(".modal-card .rv-img").evaluate((i) => i.naturalWidth > 0));
await page.locator(".rv-cap .iconbtn").click();
await page.waitForSelector(".modal-card", { state: "detached", timeout: 5000 });

// row 106 (2026-09-11 · CEMENT CO, SI# 7777) — a blank-SI photo exists for that
// same date+supplier block, filed without any SI#
await page.locator('.pp-table tbody tr:has-text("SI# 7777") .si-link').click();
await page.waitForSelector(".si-pop", { timeout: 5000 });
ok("same-block-without-SI popover: No receipt found + filed-as hint",
  (await page.locator(".si-pop .sp-none").textContent())?.includes("No receipt found") === true &&
  (await page.locator(".si-pop .sp-hint").textContent())?.includes("filed as no invoice #") === true,
  await page.locator(".si-pop").textContent().catch(() => ""));
await page.locator(".pop-backdrop").click(); // close the popover — its backdrop eats clicks
await page.waitForSelector(".si-pop", { state: "detached", timeout: 5000 });

// ---- one-click refile: fix a mistyped SI# without re-uploading ------------------
// row 106's block photo was filed without an SI# — "Use this photo for this
// invoice" re-keys it to SI# 7777 in place (PATCH) and the popover flips to an
// exact match. This is the live case: a photo uploaded as SI# 292173 vs the
// ledger's SI# 292713 heals with one click instead of delete + re-upload.
await page.locator('.pp-table tbody tr:has-text("SI# 7777") .si-link').click();
await page.waitForSelector(".si-pop", { timeout: 5000 });
const n1 = writes.length;
await page.locator('.si-pop button:has-text("Use this photo for this invoice")').click();
let patch;
for (let i = 0; i < 50 && !patch; i++) {
  patch = writes.slice(n1).find((w) => w.method === "PATCH" && w.path.includes("/rest/v1/receipts"));
  if (!patch) await sleep(100);
}
ok("refile sends PATCH with this block's keys",
  patch !== undefined && patch.body?.si_no === "SI# 7777" &&
  patch.body?.purchase_date === "2026-09-11" && patch.body?.supplier_id === 2,
  JSON.stringify(patch ?? {}));
await page.locator('.si-pop button:has-text("View Receipt")').waitFor({ timeout: 10000 });
ok("popover flips to an exact match after refile",
  (await page.locator('.si-pop button:has-text("View Receipt")').count()) === 1,
  await page.locator(".si-pop").textContent().catch(() => ""));
await page.locator('.si-pop button:has-text("View Receipt")').click();
await page.waitForSelector(".modal-card .rv-img", { timeout: 10000 });
ok("refiled photo opens as the block's View Receipt",
  await page.locator(".modal-card .rv-img").evaluate((i) => i.naturalWidth > 0));
await page.locator(".rv-cap .iconbtn").click();
await page.waitForSelector(".modal-card", { state: "detached", timeout: 5000 });

// ---- history: receipt adds, deletes and refiles land in the activity log --------
let actIns, actDel, actUpd;
for (let i = 0; i < 80 && !(actIns && actDel && actUpd); i++) {
  const acts = writes.filter((w) => w.path.includes("/rest/v1/activity_log"));
  actIns = acts.find((w) => w.body?.action === "insert" && w.body?.table_name === "receipts");
  actDel = acts.find((w) => w.body?.action === "delete" && w.body?.table_name === "receipts");
  actUpd = acts.find((w) => w.body?.action === "update" && w.body?.table_name === "receipts");
  if (!(actIns && actDel && actUpd)) await sleep(100);
}
ok("history logs every receipt add (who + which block)",
  actIns !== undefined && typeof actIns.body?.summary === "string" &&
  actIns.body.summary.startsWith("Receipt photo —") && typeof actIns.body?.actor === "string",
  JSON.stringify(actIns?.body ?? {}));
ok("history logs the receipt delete from earlier",
  actDel !== undefined && actDel.body?.summary.includes("Receipt photo —"),
  JSON.stringify(actDel?.body ?? {}));
ok("history logs the refile with from → to",
  actUpd !== undefined && actUpd.body?.summary.includes("re-filed from") &&
  actUpd.body?.details?.from?.si_no === "" && actUpd.body?.details?.to?.si_no === "SI# 7777",
  JSON.stringify(actUpd?.body ?? {}));

console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
