// Showcase screenshots for the receipt-photo feature, using the user's real
// sample receipts (receipts/1-3.png) served through the mock signed-URL route.
//   shots/receipts-tab.png     — Receipts tab: upload form + filed list w/ thumbs
//   shots/ledger-popover.png   — ledger SI# click → View Receipt popover
//   shots/receipt-viewer.png   — the viewer modal showing the actual photo
import { chromium } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "shots");

const png1 = readFileSync(join(ROOT, "receipts", "1.png"));
const png2 = readFileSync(join(ROOT, "receipts", "2.png"));
const png3 = readFileSync(join(ROOT, "receipts", "3.png"));
const bytesFor = (p) => (p.startsWith("2026-09-10") ? png1 : p.startsWith("2026-09-11") ? png2 : png3);

const suppliers = [
  { id: 1, name: "HARDWARE A", name_norm: "HARDWARE A" },
  { id: 2, name: "CEMENT CO", name_norm: "CEMENT CO" },
];
function flatRow(id, date, siNo, supplierId, material, category) {
  const sup = suppliers.find((s) => s.id === supplierId);
  return { id, purchase_date: date, si_no: siNo, supplier: sup.name, supplier_id: supplierId,
    category, category_id: 3, material, material_id: 10, material_brand: null,
    material_type: null, material_model_ver: null, material_size_native: null, material_degrees: null,
    particulars_raw: material, attributes: {}, unit_price: 135, quantity: 2, amount: 270,
    amount_source: "computed", receipt_quality: "ok", line_seq: 0, notes: "",
    created_at: `${date}T02:00:00Z`, project_name: "" };
}
const flat = [
  flatRow(101, "2026-09-10", "SI# 1001", 1, "MOLDEX PVC TEE 3X3", "PVC Pipes & Fittings"),
  flatRow(102, "2026-09-10", "SI# 1001", 1, "MOLDEX PVC ELBOW 3X90", "PVC Pipes & Fittings"),
  flatRow(103, "2026-09-11", "", 2, "DIESEL (FUEL)", "Fuel & Oil"),
  flatRow(104, "2026-09-12", "SI# 1002", 1, "MOLDEX PVC PIPE 2IN", "PVC Pipes & Fittings"),
];
const receipts = [
  { id: 1, purchase_date: "2026-09-10", si_no: "SI# 1001", supplier_id: 1,
    storage_path: "2026-09-10/si-1001.jpg", file_name: "1.png", mime_type: "image/jpeg",
    file_size: png1.length, uploaded_by: "u", created_at: "2026-09-16T10:00:00Z" },
  { id: 2, purchase_date: "2026-09-11", si_no: "", supplier_id: 2,
    storage_path: "2026-09-11/si-none.jpg", file_name: "2.png", mime_type: "image/jpeg",
    file_size: png2.length, uploaded_by: "u", created_at: "2026-09-16T10:05:00Z" },
  { id: 3, purchase_date: "2026-09-12", si_no: "SI# 1002", supplier_id: 1,
    storage_path: "2026-09-12/si-1002.jpg", file_name: "3.png", mime_type: "image/jpeg",
    file_size: png3.length, uploaded_by: "u", created_at: "2026-09-16T10:10:00Z" },
];

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
  if (url.includes("/auth/v1/user"))
    return route.fulfill(json({ id: "u", email: "owner@roro.ph", aud: "authenticated", role: "authenticated" }));
  if (url.includes("/rpc/search_materials")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/profiles")) return route.fulfill(json([{ role: "owner" }]));
  if (url.includes("/rest/v1/import_batches")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/purchases_flat")) return route.fulfill(json([...flat]));
  if (url.includes("/rest/v1/purchases")) return route.fulfill(json([{}]), 201);
  if (url.includes("/rest/v1/categories")) return route.fulfill(json([
    { id: 3, name: "PVC Pipes & Fittings", unit: "pc", sort: 1, attribute_template: [] },
    { id: 6, name: "Fuel & Oil", unit: "L", sort: 2, attribute_template: [] },
  ]));
  if (url.includes("/rest/v1/materials") || url.includes("/rest/v1/material_aliases") ||
      url.includes("/rest/v1/projects")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/suppliers")) return route.fulfill(json([...suppliers]));
  if (url.includes("/rest/v1/receipts")) {
    if (method === "GET" && u.searchParams.get("purchase_date") === null)
      return route.fulfill(json([...receipts]));
    return route.fulfill(json([...receipts]));
  }
  // storage: signed URLs serve the real sample photos
  if (url.includes("/object/sign/receipts") && method === "POST") {
    const signOne = (p) => ({ error: null, path: p, signedURL: `/object/sign/receipts/${p}?token=fake` });
    if (u.pathname.endsWith("/object/sign/receipts")) {
      const b = (() => { try { return JSON.parse(req.postData() ?? "null"); } catch { return null; } })();
      return route.fulfill(json((b?.paths ?? []).map(signOne)));
    }
    const p = decodeURIComponent(u.pathname.split("/object/sign/receipts/")[1]);
    return route.fulfill(json({ signedURL: `/object/sign/receipts/${p}?token=fake` }));
  }
  if (url.includes("/object/sign/receipts/") && method === "GET") {
    const p = decodeURIComponent(u.pathname.split("/object/sign/receipts/")[1].split("?")[0]);
    return route.fulfill({ status: 200, contentType: "image/png", body: bytesFor(p) });
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
    user: { id: "u", email: "owner@roro.ph", aud: "authenticated",
            role: "authenticated", app_metadata: {}, user_metadata: {} },
  }));
}, REF);

// 1) Receipts tab — upload form + filed list with the real photos as thumbs
await page.goto(BASE + "/#/receipts", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".rc-table tbody tr", { timeout: 20000 });
await page.locator(".rc-thumb-sm").first().waitFor({ state: "visible", timeout: 10000 });
await sleep(900); // let the signed thumbs decode
await page.screenshot({ path: join(SHOTS, "receipts-tab.png"), fullPage: true });
console.log("shot receipts-tab.png");

// 2) Ledger — SI# click opens the popover for the block that has a photo
await page.goto(BASE + "/#/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });
await page.locator('.pp-table tbody tr:has-text("SI# 1001") .si-link').first().click();
await page.waitForSelector(".si-pop", { timeout: 5000 });
await sleep(300);
await page.screenshot({ path: join(SHOTS, "ledger-popover.png") });
console.log("shot ledger-popover.png");

// 3) Viewer modal — the actual receipt photo
await page.locator('.si-pop button:has-text("View Receipt")').click();
await page.waitForSelector(".modal-card .rv-img", { timeout: 10000 });
await page.locator(".modal-card .rv-img").evaluate(
  (i) => i.complete && i.naturalWidth > 0 ? true : new Promise((res) => { i.onload = () => res(true); }));
await sleep(300);
await page.screenshot({ path: join(SHOTS, "receipt-viewer.png") });
console.log("shot receipt-viewer.png");

// 4) Entry row — staged photo on the attach button, ready to file with Add
await page.locator(".rv-cap .iconbtn").click(); // close the viewer (it closes the popover with it)
await page.locator(".pp-draft .pp-si input").fill("555");
await page.locator('.pp-draft input[placeholder="Select supplier"]').fill("HARDWARE A");
await page.locator('.pp-draft input[placeholder="Particulars"]').fill("TEST NAIL 1IN");
await page.locator('.pp-draft input[placeholder="Unit Price"]').fill("10");
await page.locator(".pp-photo input[type=file]").setInputFiles(join(ROOT, "receipts", "3.png"));
await page.waitForSelector(".pp-photo.staged img", { timeout: 5000 });
await sleep(300);
await page.screenshot({ path: join(SHOTS, "entry-row-photo.png") });
console.log("shot entry-row-photo.png");

// 5) Read-Only tab — same popover, view-only (no Add receipt button)
await page.goto(BASE + "/#/readonly", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".pp-table tbody tr", { timeout: 10000 });
await page.locator('.pp-table tbody tr:has-text("SI# 1001") .si-link').first().click();
await page.waitForSelector(".si-pop", { timeout: 5000 });
await sleep(300);
await page.screenshot({ path: join(SHOTS, "readonly-popover.png") });
console.log("shot readonly-popover.png");

await browser.close();
console.log("done");
