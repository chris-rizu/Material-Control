// Screenshot of the Particulars tab as the current build renders it
// (mocked harness — no real credentials, same fixtures as project-filter-check).
import { chromium } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";

const materials = [
  { id: 10, category_id: 3, brand: "MOLDEX", type: "PVC TEE", model_ver: null, size_native: "3X3",
    size_system: "english", degrees: null, unit: "pc", search_name: "MOLDEX PVC TEE 3X3",
    usage_count: 5, created_at: "2026-09-01T00:00:00Z" },
  { id: 11, category_id: 3, brand: "MOLDEX", type: "PVC ELBOW", model_ver: null, size_native: "3X90",
    size_system: "english", degrees: "90", unit: "pc", search_name: "MOLDEX PVC ELBOW 3X90",
    usage_count: 3, created_at: "2026-09-01T00:00:00Z" },
  { id: 12, category_id: 4, brand: null, type: "CEMENT", model_ver: null, size_native: "40KG",
    size_system: "metric", degrees: null, unit: "bag", search_name: "CEMENT 40KG",
    usage_count: 8, created_at: "2026-09-01T00:00:00Z" },
];

const json = (body, status = 200) => ({
  status,
  contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});

async function routeSupabase(route) {
  const url = route.request().url();
  if (url.includes("/rest/v1/material_aliases")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/materials")) return route.fulfill(json(materials));
  if (url.includes("/rest/v1/purchases_flat")) return route.fulfill(json([]));
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
await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });

await page.click('a[href="#/materials"]');
await page.waitForSelector("table tbody tr", { timeout: 10000 });

// sanity: report what the add form actually shows
const form = await page.evaluate(() => {
  const card = document.querySelector(".card");
  return {
    labels: [...card.querySelectorAll("label")].map((l) => l.firstChild?.textContent?.trim()),
    placeholders: [...card.querySelectorAll("input")].map((i) => i.placeholder),
    button: card.querySelector("button")?.textContent?.trim(),
  };
});
console.log("ADD FORM:", JSON.stringify(form, null, 1));

await page.screenshot({ path: "shots/materials-tab.png", fullPage: false });
console.log("saved shots/materials-tab.png");
await browser.close();
