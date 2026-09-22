// Exercises the import system end-to-end: builds a legacy-format PURCHASES
// workbook (block headers blanked, a missing AMOUNT, a wrong col-H subtotal,
// an N/A invoice, an unreadable receipt), drops it on the Import page, checks
// the preview + repairs, commits, and asserts every write — above all that
// categories the keyword rules name but the database lacks (Masonry, PVC,
// PPR, Fuel & Oil) are CREATED instead of items falling into a wrong bucket.
// The mock database starts with ONLY "Misc Hardware".
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { setTimeout as sleep } from "node:timers/promises";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";

// ---- mock database ----------------------------------------------------------
let catSeq = 7;
const cats = [{ id: 7, name: "Misc Hardware", unit: "pc", sort: 10, attribute_template: [] }];
let matSeq = 100;
const materials = [];
let supSeq = 2;
const suppliers = [{ id: 1, name: "EXISTING SUPPLIER", name_norm: "EXISTING SUPPLIER" }];
const batches = [];
const writes = []; // every POST { path, body }

// legacy workbook: title A1, headers row 3, data row 4+, header cells left
// blank on continuation lines (the file forward-fills them)
async function buildLegacyWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "PURCHASES";
  ["DATE", "INVOICE/RECEIPT", "SUPPLIER'S NAME", "PARTICULARS", "UNIT PRICE", "QUANTITY", "AMOUNT"]
    .forEach((h, i) => { ws.getCell(3, i + 1).value = h; });
  const put = (r, c, v) => { if (v !== null && v !== undefined) ws.getCell(r, c).value = v; };
  // block 1 — ABC HARDWARE, SI# 1001, 2026-09-01 (4 lines, one missing amount)
  put(4, 1, new Date(2026, 8, 1)); put(4, 2, "SI# 1001"); put(4, 3, "ABC HARDWARE");
  put(4, 4, "CEMENT RIVIERA"); put(4, 5, 250); put(4, 6, 10); put(4, 7, 2500);
  put(5, 4, "PVC ELBOW 3X90"); put(5, 5, 350); put(5, 6, 1); put(5, 7, 350);
  put(6, 4, "PPR THERMOFUSION 25MM"); put(6, 5, 100); put(6, 6, 2); put(6, 7, 200);
  put(7, 4, "ASSORTED NAILS"); put(7, 5, 50); put(7, 6, 2); // AMOUNT blank → repaired
  put(7, 8, 3100); // wrong col-H subtotal on the block's last row (true sum 3150)
  // block 2 — N/A invoice → no-invoice quality
  put(9, 1, new Date(2026, 8, 2)); put(9, 2, "N/A"); put(9, 3, "JOE'S SARI-SARI STORE");
  put(9, 4, "DIESEL (FUEL)"); put(9, 5, 55.5); put(9, 6, 10); put(9, 7, 555);
  // unreadable receipt — kept unattributed
  put(10, 4, "*RECEIPT UNREADABLE*"); put(10, 7, 500);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// round-trip workbook: the layout the app's own Export writes — PROJECT in
// column E, UNIT PRICE/QUANTITY/AMOUNT shifted to F/G/H, no subtotal column
async function buildRoundTripWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "PURCHASES";
  ["DATE", "INVOICE/RECEIPT", "SUPPLIER'S NAME", "PARTICULARS", "PROJECT",
   "UNIT PRICE", "QUANTITY", "AMOUNT"].forEach((h, i) => { ws.getCell(3, i + 1).value = h; });
  const put = (r, c, v) => { if (v !== null && v !== undefined) ws.getCell(r, c).value = v; };
  put(4, 1, new Date(2026, 8, 5)); put(4, 2, "SI# 4001"); put(4, 3, "ABC HARDWARE");
  put(4, 4, "CEMENT RIVIERA"); put(4, 5, "SITE A"); put(4, 6, 250); put(4, 7, 2); put(4, 8, 500);
  put(5, 4, "PVC ELBOW 3X90"); put(5, 5, "SITE B"); put(5, 6, 350); put(5, 7, 1); put(5, 8, 350);
  put(6, 4, "PVC PIPE 4"); put(6, 6, 240); put(6, 7, 1); put(6, 8, 240); // blank project = same as above
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// discount workbook: the real client files record a block discount as its own
// row — "DISCOUNT n%", the discount VALUE in AMOUNT (positive), and the block's
// NET total in col H on that row. Two blocks, same discount text, to also prove
// the duplicate scan ignores adjustment rows.
async function buildDiscountWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "PURCHASES";
  ["DATE", "INVOICE/RECEIPT", "SUPPLIER'S NAME", "PARTICULARS", "UNIT PRICE", "QUANTITY", "AMOUNT"]
    .forEach((h, i) => { ws.getCell(3, i + 1).value = h; });
  const put = (r, c, v) => { if (v !== null && v !== undefined) ws.getCell(r, c).value = v; };
  // block 1 — items sum 6,000; DISCOUNT 30% = 1,800; net 4,200 in H on its row
  put(4, 1, new Date(2026, 8, 10)); put(4, 2, "SI# 22565"); put(4, 3, "CEBU LUCKY MACHINERY, INC.");
  put(4, 4, "PVC PIPE 4"); put(4, 5, 2000); put(4, 6, 2); put(4, 7, 4000);
  put(5, 4, "PVC ELBOW 3X90"); put(5, 5, 2000); put(5, 6, 1); put(5, 7, 2000);
  put(5, 8, 6000); // gross subtotal on the last ITEM row
  put(6, 4, "DISCOUNT 30%"); put(6, 7, 1800); put(6, 8, 4200); // net on the discount row
  // block 2 — item 500; DISCOUNT 20% = 100; net 400
  put(8, 1, new Date(2026, 8, 11)); put(8, 2, "SI# 22566"); put(8, 3, "CEBU LUCKY MACHINERY, INC.");
  put(8, 4, "CEMENT RIVIERA"); put(8, 5, 250); put(8, 6, 2); put(8, 7, 500);
  put(9, 4, "DISCOUNT 20%"); put(9, 7, 100); put(9, 8, 400);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const json = (body, status = 200) => ({
  status, contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});

async function routeSupabase(route) {
  const req = route.request();
  const url = req.url();
  const method = req.method();
  const u = new URL(url);
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  const body = () => { try { return JSON.parse(req.postData() ?? "null"); } catch { return null; } };

  if (method === "POST") writes.push({ path: u.pathname, body: body() });

  if (url.includes("/auth/v1/user"))
    return route.fulfill(json({ id: "11111111-1111-1111-1111-111111111111",
                                email: "owner@roro.ph", aud: "authenticated", role: "authenticated" }));
  if (url.includes("/rest/v1/rpc/search_materials")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/profiles")) return route.fulfill(json([{ role: "owner" }]));
  if (url.includes("/rest/v1/projects")) {
    if (method === "POST") return route.fulfill(json({ id: 900, ...body() }), 201);
    return route.fulfill(json([]));
  }
  if (url.includes("/rest/v1/purchases_flat")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/purchases")) return route.fulfill(json([], 201));

  if (url.includes("/rest/v1/categories")) {
    if (method === "POST") {
      const row = { id: ++catSeq, attribute_template: [], ...body() };
      cats.push(row);
      return route.fulfill(json(wantsObject ? row : [row]), 201);
    }
    const nameQ = u.searchParams.get("name");
    if (nameQ !== null && nameQ.startsWith("ilike.")) {
      const val = nameQ.slice(6).toUpperCase();
      const hit = cats.find((c) => c.name.toUpperCase() === val) ?? null;
      return route.fulfill(json(wantsObject ? hit : hit ? [hit] : []));
    }
    if (u.searchParams.get("select") === "sort") { // max-sort lookup for the next sort
      const max = cats.reduce((a, c) => (c.sort > a.sort ? c : a), cats[0]);
      return route.fulfill(json(wantsObject ? { sort: max.sort } : [{ sort: max.sort }]));
    }
    return route.fulfill(json([...cats]));
  }

  if (url.includes("/rest/v1/materials")) {
    if (method === "POST") {
      const row = { id: ++matSeq, search_name: "", size_metric: "", reference_price: null,
                    usage_count: 0, last_used_at: null, ...body() };
      materials.push(row);
      return route.fulfill(json(wantsObject ? row : [row]), 201);
    }
    return route.fulfill(json(wantsObject ? null : [])); // twin check → none
  }

  if (url.includes("/rest/v1/suppliers")) {
    if (method === "POST") {
      const b = body();
      const norm = String(b?.name ?? "").toUpperCase().replace(/\s+/g, " ").trim();
      let hit = suppliers.find((s) => s.name_norm === norm);
      if (!hit) { hit = { id: ++supSeq, name: b.name, name_norm: norm }; suppliers.push(hit); }
      return route.fulfill(json(wantsObject ? hit : [hit]), 201);
    }
    const normEq = u.searchParams.get("name_norm");
    if (normEq !== null) {
      const val = (normEq.startsWith("eq.") ? normEq.slice(3) : normEq);
      const hit = suppliers.find((s) => s.name_norm === val) ?? null;
      return route.fulfill(json(wantsObject ? hit : hit ? [hit] : []));
    }
    return route.fulfill(json(suppliers));
  }

  if (url.includes("/rest/v1/import_batches")) {
    if (method === "POST") {
      const row = { id: "b0000000-0000-0000-0000-000000000001",
                    imported_at: new Date().toISOString(), ...body() };
      batches.push(row);
      return route.fulfill(json(row), 201);
    }
    const shaQ = u.searchParams.get("file_sha256");
    if (shaQ !== null) {
      const sha = shaQ.startsWith("eq.") ? shaQ.slice(3) : shaQ;
      const hit = batches.find((b) => b.file_sha256 === sha) ?? null;
      return route.fulfill(json(wantsObject ? hit : hit ? [hit] : []));
    }
    return route.fulfill(json([...batches]));
  }

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
  try { await page.goto(BASE + "/#/import", { waitUntil: "domcontentloaded", timeout: 1500 }); up = true; }
  catch { await sleep(500); }
}
if (!up) { console.error("PREVIEW NOT UP"); process.exit(1); }
await page.waitForSelector(".dropzone", { timeout: 10000 });

const results = [];
const ok = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);

// ---- drop the workbook, read the preview ------------------------------------
const wbBuf = await buildLegacyWorkbook();
await page.setInputFiles('input[type="file"]', {
  name: "PURCHASES (1).xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: wbBuf,
});
await page.waitForSelector(".imp-stats", { timeout: 10000 });

const stats = (await page.locator(".imp-stat .v").allTextContents()).map((s) => s.trim());
ok("preview counts 6 lines / 3 blocks", stats[0] === "6" && stats[1] === "3", JSON.stringify(stats));
ok("grand totals: repaired ₱4,205.00 vs stored ₱4,105.00",
   stats[2]?.includes("4,205.00") && stats[3]?.includes("4,105.00"), JSON.stringify(stats));

const chips = (await page.locator(".chip").allTextContents()).map((s) => s.trim());
ok("repairs flagged: missing-amount, wrong-subtotal, unreadable",
   chips.length === 3 && chips.includes("missing-amount") &&
   chips.includes("wrong-subtotal") && chips.includes("unreadable"), JSON.stringify(chips));

const blockRows = await page.locator("table:has(th:text('Old subtotal')) tbody tr").count();
ok("invoice blocks table lists 3 blocks", blockRows === 3, String(blockRows));
const block1cells = await page
  .locator("table:has(th:text('Old subtotal')) tbody tr")
  .first().locator("td").allTextContents();
ok("blocks table flags block 1's wrong col-H subtotal (3100 ≠ 3150)",
  block1cells[5]?.includes("3,100.00") && block1cells[5]?.includes("≠") === true,
  JSON.stringify(block1cells));

// ---- commit ------------------------------------------------------------------
await page.locator('button:has-text("Import 6 lines into the database")').click();
await page.waitForSelector(".banner.ok", { timeout: 20000 });
ok("success banner after import",
   (await page.locator(".banner.ok").textContent())?.includes("Imported 6 lines") === true);
ok("the export card now shows this batch as the last import",
   (await page.locator('span:has-text("Last import:")').textContent())?.includes("PURCHASES (1).xlsx") === true);

// ---- assert every write -------------------------------------------------------
const post = (frag) => writes.filter((w) => w.path.includes(frag)).map((w) => w.body);

const catPosts = post("/categories");
ok("created exactly the 4 missing categories",
   JSON.stringify(catPosts.map((c) => c.name)) ===
   JSON.stringify(["Masonry", "PVC Pipes & Fittings", "PPR Pipes & Fittings", "Fuel & Oil"]),
   JSON.stringify(catPosts.map((c) => c.name)));
ok("created categories carry units (Fuel & Oil = L, rest pc)",
   catPosts.every((c) => (c.name === "Fuel & Oil" ? c.unit === "L" : c.unit === "pc")) &&
   catPosts.every((c) => typeof c.sort === "number" && c.sort > 10),
   JSON.stringify(catPosts.map((c) => [c.name, c.unit, c.sort])));

const idOf = {};
for (const c of [...cats]) idOf[c.name] = c.id;
const matPosts = post("/materials");
ok("6 new materials created (one per distinct particular)", matPosts.length === 6, String(matPosts.length));
const catIdFor = (t) =>
  matPosts.find((m) => (m.type ?? "").includes(t))?.category_id;
ok("CEMENT RIVIERA landed in the NEW Masonry category",
   catIdFor("CEMENT") === idOf["Masonry"], String(catIdFor("CEMENT")));
ok("PVC ELBOW in the NEW PVC category", catIdFor("ELBOW") === idOf["PVC Pipes & Fittings"],
   String(catIdFor("ELBOW")));
ok("DIESEL in the NEW Fuel & Oil category", catIdFor("DIESEL") === idOf["Fuel & Oil"],
   String(catIdFor("DIESEL")));
ok("ASSORTED NAILS stays in the EXISTING Misc Hardware",
   catIdFor("NAILS") === idOf["Misc Hardware"], String(catIdFor("NAILS")));

const purchaseRows = post("/purchases").flat();
ok("one purchases insert of 6 rows", purchaseRows.length === 6, String(purchaseRows.length));
const supIdFor = (name) => suppliers.find((s) => s.name === name)?.id;
const r = purchaseRows;
ok("line 1: date/SI/supplier/category/amount + creation note",
   r[0]?.purchase_date === "2026-09-01" && r[0]?.si_no === "SI# 1001" &&
   r[0]?.supplier_id === supIdFor("ABC HARDWARE") &&
   r[0]?.category_id === idOf["Masonry"] && r[0]?.amount === 2500 &&
   r[0]?.receipt_quality === "ok" && r[0]?.line_seq === 0 &&
   String(r[0]?.notes ?? "").includes("Masonry"),
   JSON.stringify(r[0]));
ok("continuation lines forward-fill SI + supplier",
   r[1]?.si_no === "SI# 1001" && r[1]?.supplier_id === supIdFor("ABC HARDWARE") &&
   r[2]?.si_no === "SI# 1001" && r[2]?.category_id === idOf["PPR Pipes & Fittings"] &&
   r[1]?.line_seq === 1 && r[2]?.line_seq === 2,
   JSON.stringify([r[1]?.si_no, r[2]?.si_no, r[2]?.category_id]));
ok("missing AMOUNT repaired: 50×2 = 100 (import_missing_filled)",
   r[3]?.amount === 100 && r[3]?.amount_source === "import_missing_filled" &&
   r[3]?.category_id === idOf["Misc Hardware"],
   JSON.stringify([r[3]?.amount, r[3]?.amount_source]));
ok("N/A invoice line kept as no-invoice",
   r[4]?.purchase_date === "2026-09-02" && r[4]?.si_no === "N/A" &&
   r[4]?.supplier_id === supIdFor("JOE'S SARI-SARI STORE") &&
   r[4]?.receipt_quality === "no-invoice" && r[4]?.category_id === idOf["Fuel & Oil"],
   JSON.stringify(r[4]));
ok("unreadable receipt kept unattributed (no supplier/SI)",
   r[5]?.si_no === "" && r[5]?.supplier_id === null &&
   r[5]?.receipt_quality === "unreadable" && r[5]?.amount === 500,
   JSON.stringify(r[5]));

const supPosts = post("/suppliers");
ok("both new suppliers created",
   JSON.stringify(supPosts.map((s) => s.name).sort()) ===
   JSON.stringify(["ABC HARDWARE", "JOE'S SARI-SARI STORE"]),
   JSON.stringify(supPosts.map((s) => s.name)));

const batchPosts = post("/import_batches");
ok("import batch recorded (6 lines, repaired grand total)",
   batchPosts.length === 1 && batchPosts[0]?.line_count === 6 &&
   Number(batchPosts[0]?.grand_total) === 4205,
   JSON.stringify(batchPosts));

// ---- idempotency guard: same file again → dupe warning -----------------------
await page.setInputFiles('input[type="file"]', {
  name: "PURCHASES (1).xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: wbBuf,
});
await page.waitForSelector(".banner.warn", { timeout: 10000 });
ok("same file again → duplicate warning",
   (await page.locator(".banner.warn").textContent())?.includes("already imported") === true);
ok("Import disabled until 'Import anyway' is ticked",
   await page.locator('button:has-text("Import 6 lines into the database")').isDisabled());

// ---- round trip: the app's own 8-column export re-imports losslessly ---------
await page.setInputFiles('input[type="file"]', {
  name: "PURCHASES_export_2026-09-19.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: await buildRoundTripWorkbook(),
});
await page.waitForSelector(".imp-stats", { timeout: 10000 });
const stats8 = (await page.locator(".imp-stat .v").allTextContents()).map((x) => x.trim());
ok("8-column export: 3 lines / 1 block parsed",
   stats8[0] === "3" && stats8[1] === "1", JSON.stringify(stats8));
ok("8-column export: AMOUNT in H is NOT misread as a subtotal (no repairs)",
   (await page.locator(".chip").count()) === 0 &&
   stats8[2]?.includes("1,090.00") && stats8[3]?.includes("1,090.00"), JSON.stringify(stats8));

const w8 = writes.length;
await page.locator('button:has-text("Import 3 lines into the database")').click();
await page.waitForSelector(".banner.ok", { timeout: 20000 });
const rows8 = writes.slice(w8).filter((w) => w.path.includes("/rest/v1/purchases"))
  .map((w) => w.body).flat();
ok("round trip keeps the PROJECT on every line (forward-filled where blank)",
   rows8.length === 3 &&
   rows8[0]?.project_name === "SITE A" && rows8[1]?.project_name === "SITE B" &&
   rows8[2]?.project_name === "SITE B" &&
   rows8[2]?.amount === 240,
   JSON.stringify(rows8.map((x) => [x.project_name, x.amount])));
ok("round trip re-creates the project catalog entries",
   writes.slice(w8).filter((w) => w.path.includes("/rest/v1/projects"))
     .map((w) => w.body?.name).sort().join("|") === "SITE A|SITE B");

// ---- discounts: "DISCOUNT n%" rows become negative adjustment lines ----------
const wDisc = writes.length;
await page.setInputFiles('input[type="file"]', {
  name: "PURCHASES (3).xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: await buildDiscountWorkbook(),
});
await page.waitForSelector(".imp-stats", { timeout: 10000 });
const statsD = (await page.locator(".imp-stat .v").allTextContents()).map((x) => x.trim());
ok("discount file: 5 lines / 2 blocks parsed", statsD[0] === "5" && statsD[1] === "2", JSON.stringify(statsD));
ok("discount file totals are NET of discounts (4,600.00)",
   statsD[2]?.includes("4,600.00") && statsD[3]?.includes("4,600.00"), JSON.stringify(statsD));

const chipsD = (await page.locator(".chip").allTextContents()).map((s) => s.trim());
ok("both discount rows flagged, no wrong-subtotal, no false duplicate",
   chipsD.filter((c) => c === "discount").length === 2 &&
   !chipsD.includes("wrong-subtotal") && !chipsD.includes("possible-duplicate"),
   JSON.stringify(chipsD));

// block 1: lines sum 6,000 − 1,800 = 4,200 = col H → no "≠" flag
const discCells = await page
  .locator("table:has(th:text('Old subtotal')) tbody tr").first().locator("td").allTextContents();
ok("discount block sums to its col-H net (4,200.00, no mismatch flag)",
   discCells[4]?.includes("4,200.00") && discCells[5]?.includes("4,200.00") &&
   discCells[5]?.includes("≠") === false,
   JSON.stringify(discCells));

await page.locator('button:has-text("Import 5 lines into the database")').click();
await page.waitForSelector(".banner.ok", { timeout: 20000 });
const discRows = writes.slice(wDisc).filter((w) => w.path.includes("/rest/v1/purchases"))
  .map((w) => w.body).flat();
const discLine = discRows.find((x) => x.particulars_raw === "DISCOUNT 30%");
ok("discount stored as a NEGATIVE line (−1,800, receipt truth)",
   discLine?.amount === -1800 && discLine?.unit_price === 0 && discLine?.quantity === 1 &&
   discLine?.amount_source === "manual",
   JSON.stringify(discLine));
ok("discount gets NO material and NO category (adjustment, not a purchase)",
   discLine?.material_id === null && discLine?.category_id === null &&
   String(discLine?.notes ?? "").includes("discount"),
   JSON.stringify([discLine?.material_id, discLine?.category_id, discLine?.notes]));
const discMats = writes.slice(wDisc).filter((w) => w.path.includes("/rest/v1/materials"))
  .map((w) => w.body);
ok("no material created for any DISCOUNT text (3 real items only)",
   discMats.length === 3 && !discMats.some((m) => /discount/i.test(m?.type ?? "")),
   JSON.stringify(discMats.map((m) => m.type)));
const discBatch = writes.slice(wDisc).filter((w) => w.path.includes("/import_batches"))
  .map((w) => w.body);
ok("batch recorded at the NET total (4,600)",
   discBatch[0]?.line_count === 5 && Number(discBatch[0]?.grand_total) === 4600,
   JSON.stringify(discBatch));

console.log(results.join("\n"));
await browser.close();
process.exit(results.some((x) => x.startsWith("FAIL")) ? 1 : 0);
