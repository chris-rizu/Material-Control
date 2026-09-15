// Verifies the entry row's Brand box on Purchases — predictive box + the
// save rules: filled brand is prepended to the particulars on save, a blank
// brand saves the particulars untouched, and a particular that already
// starts with the brand is not doubled. Picking a brand also steers the
// Particulars suggestions (searched as "BRAND + typed") and a picked
// suggestion still prefills the last price. The POST bodies to
// /rest/v1/purchases and the search_materials calls are recorded.
import { chromium } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";

const writes = [];
const searchQs = [];

const materials = [
  { id: 10, category_id: 3, brand: "MOLDEX", type: "PVC TEE", size_native: "3X3", degrees: null,
    unit: "pc", search_name: "MOLDEX PVC TEE 3X3", usage_count: 5 },
  { id: 11, category_id: 3, brand: "MOLDEX", type: "PVC ELBOW", size_native: "3X90", degrees: "90",
    unit: "pc", search_name: "MOLDEX PVC ELBOW 3X90", usage_count: 3 },
  { id: 12, category_id: 3, brand: "GOWIDE", type: "PVC PIPE", size_native: "4", degrees: null,
    unit: "pc", search_name: "GOWIDE PVC PIPE 4", usage_count: 2 },
  { id: 13, category_id: 4, brand: null, type: "CEMENT", size_native: "40KG", degrees: null,
    unit: "bag", search_name: "CEMENT 40KG", usage_count: 8 },
];

const teeHit = { id: 10, search_name: "MOLDEX PVC TEE 3X3", brand: "MOLDEX", type: "PVC TEE",
  size_native: "3X3", degrees: null, last_unit_price: 374.8 };

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
    writes.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill(json([{ id: 901 }], 201));
  }
  if (url.includes("/rpc/search_materials")) {
    let q = "";
    try { q = JSON.parse(route.request().postData() ?? "{}").q ?? ""; } catch { /* bodyless */ }
    searchQs.push(q);
    return route.fulfill(json([teeHit]));
  }
  if (url.includes("/rest/v1/purchases_flat")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/categories"))
    return route.fulfill(json([{ id: 3, name: "PVC Pipes & Fittings", sort: 1, unit: "pc" }]));
  if (url.includes("/rest/v1/suppliers"))
    return route.fulfill(json([{ id: 1, name: "HARDWARE A", name_norm: "HARDWARE A" }]));
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
await page.waitForSelector(".pp-brand .predictive input", { timeout: 10000 });

const results = [];
const ok = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);

await page.fill(".pp-si input", "2001"); // digits only — the SI# prefix is fixed
await page.fill(".pp-sup input", "HARDWARE A");

// ---- predictive brand box ----------------------------------------------------
await page.click(".pp-brand input");
await page.waitForSelector(".pp-brand .dropdown .o-name", { timeout: 4000 });
const all = await page.$$eval(".pp-brand .dropdown .o-name", (els) => els.map((e) => e.textContent));
ok("empty Brand box lists the catalog brands", all.join("|") === "GOWIDE|MOLDEX", all.join("|"));

await page.fill(".pp-brand input", "mol");
await page.waitForTimeout(200);
const filteredOpts = await page.$$eval(".pp-brand .dropdown .o-name", (els) => els.map((e) => e.textContent));
ok("typing filters the brand suggestions", filteredOpts.join("|") === "MOLDEX", filteredOpts.join("|"));
await page.click(".pp-brand .dropdown .option");
const bv = await page.inputValue(".pp-brand input");
ok("picking fills the exact brand (assumption)", bv === "MOLDEX", bv);

// ---- brand steers the Particulars suggestions --------------------------------
await page.fill(".pp-part input", "TEE");
await page.waitForSelector(".pp-part .dropdown .o-name", { timeout: 6000 });
const hits = await page.$$eval(".pp-part .dropdown .o-name", (els) => els.map((e) => e.textContent));
ok("suggestions searched as BRAND + typed (MOLDEX TEE)", searchQs.includes("MOLDEX TEE"),
  JSON.stringify(searchQs));
ok("suggestion shown from that search", hits.includes("MOLDEX PVC TEE 3X3"), hits.join("|"));
await page.click(".pp-part .dropdown .option");
const pv = await page.inputValue(".pp-part input");
const price = await page.inputValue('.pp-draft input[placeholder="Unit Price"]');
ok("picked suggestion puts the brand-less remainder in the box", pv === "PVC TEE 3X3", pv);
ok("picked suggestion still prefills the last price", price === "374.8", price);

await page.fill('.pp-draft input[placeholder="Qty"]', "2");
await page.click(".pp-add");
let before = writes.length;
for (let i = 0; i < 50 && writes.length === before; i++) await sleep(100);
const w1 = writes[writes.length - 1];
ok("saved row = BRAND + remainder, price kept",
  w1?.particulars_raw === "MOLDEX PVC TEE 3X3" && w1?.unit_price === 374.8 && w1?.quantity === 2,
  JSON.stringify([w1?.particulars_raw, w1?.unit_price, w1?.quantity]));

// ---- mechanical save rules ---------------------------------------------------
async function addLine({ brand, particulars, price, qty = "" }) {
  await page.fill(".pp-brand input", brand);
  await page.fill(".pp-part input", particulars);
  await page.fill('.pp-draft input[placeholder="Unit Price"]', price);
  if (qty) await page.fill('.pp-draft input[placeholder="Qty"]', qty);
  before = writes.length;
  await page.click(".pp-add");
  for (let i = 0; i < 50 && writes.length === before; i++) await sleep(100);
  return writes[writes.length - 1];
}

const w2 = await addLine({ brand: "MOLDEX", particulars: "MOLDEX PVC ELBOW 3X90", price: "350" });
ok("particular already starting with the brand is not doubled",
  w2?.particulars_raw === "MOLDEX PVC ELBOW 3X90", JSON.stringify(w2?.particulars_raw));

const w3 = await addLine({ brand: "", particulars: "ASSORTED NAILS", price: "50" });
ok("blank brand saves just the particulars",
  w3?.particulars_raw === "ASSORTED NAILS", JSON.stringify(w3?.particulars_raw));

const after = await page.evaluate(() => ({
  brand: document.querySelector(".pp-brand input")?.value,
  part: document.querySelector(".pp-part input")?.value,
  si: document.querySelector(".pp-si input")?.value,
}));
ok("brand + particulars clear after save (SI# stays)",
  after.brand === "" && after.part === "" && after.si === "2001", JSON.stringify(after));

await page.locator(".pp-card").first().screenshot({ path: "shots/entry-brand.png" });
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
