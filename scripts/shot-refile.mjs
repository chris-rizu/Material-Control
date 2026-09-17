// Evidence shots for the one-click receipt refile — the live case behind it:
// a photo uploaded as SI# 292173 vs the ledger's SI# 292713 (transposed
// digits, same date + supplier). 1) the popover names the misfiled photo,
// 2) "Use this photo for this invoice" re-keys it and flips to an exact
// match, 3) the photo opens. Mocked DB — same harness shape as receipt-check.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs");
mkdirSync(OUT, { recursive: true });

// 1x1 PNG served in place of the stored photo (the viewer only needs a
// decodable image so naturalWidth proves the signed URL rendered)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const suppliers = [
  { id: 7, name: "CEBU LUCKY MACHINERY, INC.", name_norm: "CEBU LUCKY MACHINERY, INC." },
];
function flatRow(id, material) {
  return { id, purchase_date: "2026-09-03", si_no: "SI# 292713",
    supplier: suppliers[0].name, supplier_id: 7,
    category: "PVC Pipes & Fittings", category_id: 3, material, material_id: 10,
    material_brand: null, material_type: null, material_model_ver: null,
    material_size_native: null, material_degrees: null, particulars_raw: material,
    attributes: {}, unit_price: 100, quantity: 1, amount: 100,
    amount_source: "computed", receipt_quality: "ok", line_seq: 0, notes: "",
    created_at: "2026-09-03T02:00:00Z", project_name: "" };
}
const flat = [
  flatRow(201, "MOLDEX PVC TEE 3X3"),
  flatRow(202, "MOLDEX PVC ELBOW 3X90"),
  flatRow(203, "MOLDEX PVC CAP 2IN"),
];
// the photo on file was uploaded with the SI# mistyped (292173, not 292713)
const receipts = [{
  id: 31, purchase_date: "2026-09-03", si_no: "SI# 292173", supplier_id: 7,
  storage_path: "2026-09-03/si-292173_7_0.jpg", file_name: "receipt-lucky.jpg",
  mime_type: "image/jpeg", file_size: 98765, uploaded_by: null,
  created_at: "2026-09-17T01:30:00Z",
}];

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
  ]));
  if (url.includes("/rest/v1/materials")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/material_aliases")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/projects")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/suppliers")) return route.fulfill(json([...suppliers]));
  if (url.includes("/rest/v1/activity_log")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/receipts")) {
    if (method === "PATCH") {
      const v = u.searchParams.get("id");
      const id = v !== null && v.startsWith("eq.") ? Number(v.slice(3)) : Number(v);
      const row = receipts.find((r) => r.id === id);
      const body = (() => { try { return JSON.parse(req.postData() ?? "null"); } catch { return null; } })();
      if (row && body) Object.assign(row, body);
      return route.fulfill(json(row ? [{ id: row.id }] : []));
    }
    return route.fulfill(json([...receipts]));
  }
  if (url.includes("/storage/v1/object/receipts/") && method === "GET") {
    return route.fulfill(png()); // authenticated download (receipt photo cache)
  }
  if (url.includes("/storage/v1/object/sign/receipts/") && method === "GET") {
    return route.fulfill(png()); // the signed URL itself serves the bytes
  }
  if (url.includes("/storage/v1/object/sign/receipts") && method === "POST") {
    const signOne = (p) => ({ error: null, path: p, signedURL: `/object/sign/receipts/${p}?token=fake` });
    if (u.pathname.endsWith("/object/sign/receipts")) {
      const body = (() => { try { return JSON.parse(req.postData() ?? "null"); } catch { return null; } })();
      return route.fulfill(json((body?.paths ?? []).map(signOne)));
    }
    // single createSignedUrl: the path follows the bucket in the URL
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
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.addInitScript((ref) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
    access_token: "fake-access", refresh_token: "fake-refresh", token_type: "bearer",
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "11111111-1111-1111-1111-111111111111", email: "owner@roro.ph",
            aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} },
  }));
}, REF);

await page.goto(BASE + "/");
await page.waitForSelector(".pp-table tbody tr", { timeout: 15000 });

// 1 — the SI# 292713 popover names the photo filed as SI# 292173
await page.locator('.pp-table tbody tr:has-text("SI# 292713") .si-link').first().click();
await page.waitForSelector(".si-pop", { timeout: 5000 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, "refile-1-near-miss.png") });

// 2 — one click re-keys the photo; the popover flips to an exact match
await page.locator('.si-pop button:has-text("Use this photo for this invoice")').click();
await page.locator('.si-pop button:has-text("View Receipt")').waitFor({ timeout: 10000 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, "refile-2-exact-match.png") });

// 3 — the re-keyed photo opens as this invoice's receipt
await page.locator('.si-pop button:has-text("View Receipt")').click();
await page.waitForSelector(".modal-card .rv-img", { timeout: 10000 });
const src = await page.locator(".modal-card .rv-img").getAttribute("src");
const okImg = await page.locator(".modal-card .rv-img").evaluate((i) => i.naturalWidth > 0);
if (!okImg) {
  await page.screenshot({ path: join(OUT, "refile-debug.png") });
  console.error("img src:", src);
}
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, "refile-3-photo-open.png") });
await browser.close();

if (!okImg) { console.error("FAIL — viewer image did not render"); process.exit(1); }
if (pageErrors.length) { console.error("pageerrors:", pageErrors); process.exit(1); }
console.log("EVIDENCE OK — 3 shots in docs/");
