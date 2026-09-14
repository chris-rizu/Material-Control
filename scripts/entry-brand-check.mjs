// Verifies the entry row's Brand box on Purchases: filled brand is prepended
// to the particulars on save, a blank brand saves the particulars untouched,
// and a particular that already starts with the brand is not doubled.
// Same mocked harness — the POST bodies to /rest/v1/purchases are recorded.
import { chromium } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";

const writes = [];

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
  if (url.includes("search_materials")) return route.fulfill(json([{ id: 10 }]));
  if (url.includes("/rest/v1/purchases_flat")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/categories"))
    return route.fulfill(json([{ id: 3, name: "PVC Pipes & Fittings", sort: 1, unit: "pc" }]));
  if (url.includes("/rest/v1/suppliers"))
    return route.fulfill(json([{ id: 1, name: "HARDWARE A", name_norm: "HARDWARE A" }]));
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

const hasBrandBox = await page.$(".pp-draft input.pp-brand");
ok("entry row has the Brand box between supplier and particulars", !!hasBrandBox);

// fill the static parts once (date is prefilled; supplier exact-matches)
await page.fill('.pp-draft input[placeholder="SI#"]', "SI# 2001");
await page.fill(".pp-sup input", "HARDWARE A");

async function addLine({ brand, particulars, price, qty = "" }) {
  await page.fill(".pp-brand", brand);
  await page.fill(".pp-part input", particulars);
  await page.fill('.pp-draft input[placeholder="Unit Price"]', price);
  if (qty) await page.fill('.pp-draft input[placeholder="Qty"]', qty);
  const before = writes.length;
  await page.click(".pp-add");
  for (let i = 0; i < 50 && writes.length === before; i++) await sleep(100);
  return writes[writes.length - 1];
}

const w1 = await addLine({ brand: " moldex ", particulars: "PVC TEE 3X3", price: "374.80", qty: "2" });
ok("filled brand is normalized + prepended",
  w1?.particulars_raw === "MOLDEX PVC TEE 3X3", JSON.stringify(w1?.particulars_raw));

const w2 = await addLine({ brand: "MOLDEX", particulars: "MOLDEX PVC ELBOW 3X90", price: "350" });
ok("particular already starting with the brand is not doubled",
  w2?.particulars_raw === "MOLDEX PVC ELBOW 3X90", JSON.stringify(w2?.particulars_raw));

const w3 = await addLine({ brand: "", particulars: "ASSORTED NAILS", price: "50" });
ok("blank brand saves just the particulars",
  w3?.particulars_raw === "ASSORTED NAILS", JSON.stringify(w3?.particulars_raw));

ok("price/qty/project still arrive with the row",
  w1?.unit_price === 374.8 && w1?.quantity === 2 &&
  w2?.unit_price === 350 && w3?.unit_price === 50,
  JSON.stringify(writes.map((w) => [w.particulars_raw, w.unit_price, w.quantity])));

// boxes clear after save; date/SI/supplier stay
const after = await page.evaluate(() => ({
  brand: document.querySelector(".pp-brand")?.value,
  part: document.querySelector(".pp-part input")?.value,
  si: document.querySelector('.pp-draft input[placeholder="SI#"]')?.value,
}));
ok("brand + particulars clear after save (SI# stays)",
  after.brand === "" && after.part === "" && after.si === "SI# 2001", JSON.stringify(after));

await page.locator(".pp-card").first().screenshot({ path: "shots/entry-brand.png" });
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
