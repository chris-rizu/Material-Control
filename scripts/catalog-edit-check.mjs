// Verifies edit + delete across all four catalogs on the Particulars tab:
// Categories (rename + unit change; delete blocked with a friendly banner
// while particulars sit in it, allowed when empty), Projects (rename also
// re-points the ledger's free-text project_name lines), Suppliers (the new
// card: add / rename / delete with used counts), and Particulars (inline
// edit row patching brand/type/model/size/degrees/unit/category; delete with
// the usage warning). PATCH/DELETE calls are recorded and asserted.
import { chromium } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";

// ---- mock database ----------------------------------------------------------
const cats = [
  { id: 3, name: "PVC Pipes & Fittings", unit: "pc", sort: 1, attribute_template: [] },
  { id: 4, name: "Cement", unit: "bag", sort: 2, attribute_template: [] },
  { id: 9, name: "Painting", unit: "pc", sort: 3, attribute_template: [] }, // empty → deletable
];
let matSeq = 12;
const materials = [
  { id: 10, category_id: 3, brand: "MOLDEX", type: "PVC TEE", model_ver: "", size_native: "3X3",
    degrees: 0, unit: "pc", search_name: "MOLDEX PVC TEE 3X3", usage_count: 5 },
  { id: 11, category_id: 3, brand: "MOLDEX", type: "PVC ELBOW", model_ver: "", size_native: "3X90",
    degrees: 90, unit: "pc", search_name: "MOLDEX PVC ELBOW 3X90", usage_count: 3 },
  { id: 12, category_id: 4, brand: "", type: "CEMENT", model_ver: "", size_native: "40KG",
    degrees: 0, unit: "bag", search_name: "CEMENT 40KG", usage_count: 8 },
];
const suppliers = [
  { id: 1, name: "HARDWARE A", name_norm: "HARDWARE A" },
  { id: 2, name: "CEMENT CO", name_norm: "CEMENT CO" },
];
const projects = [
  { id: 1, name: "MCDO", name_norm: "MCDO", created_at: "2026-09-01T00:00:00Z" },
  { id: 2, name: "Talisay", name_norm: "TALISAY", created_at: "2026-09-01T00:00:00Z" },
];
const flat = [
  flatRow(101, "HARDWARE A", 1, "MCDO", 3, 10, "MOLDEX PVC TEE 3X3", "PVC Pipes & Fittings"),
  flatRow(102, "HARDWARE A", 1, "MCDO", 3, 10, "MOLDEX PVC TEE 3X3", "PVC Pipes & Fittings"),
  flatRow(103, "CEMENT CO", 2, "Talisay", 4, 12, "CEMENT 40KG", "Cement"),
];
function flatRow(id, supplier, supplierId, project, categoryId, materialId, material, category) {
  return { id, purchase_date: "2026-09-10", si_no: "SI# 292713", supplier, supplier_id: supplierId,
    category, category_id: categoryId, material, material_id: materialId, material_brand: null,
    material_type: null, material_model_ver: null, material_size_native: null, material_degrees: null,
    particulars_raw: material, attributes: {}, unit_price: 100, quantity: 1, amount: 100,
    amount_source: "computed", receipt_quality: "ok", line_seq: 0, notes: "",
    created_at: "2026-09-10T02:00:00Z", project_name: project };
}

const writes = []; // every mutating call { method, path, body }
let supSeq = 2;

const json = (body, status = 200) => ({
  status, contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});
const noContent = () => ({ status: 204 });
const fkViolation = () => ({
  status: 409, contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify({ code: "23503", message: "update or delete on table violates foreign key constraint" }),
});

async function routeSupabase(route) {
  const req = route.request();
  const url = req.url();
  const method = req.method();
  const u = new URL(url);
  const wantsObject = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
  const body = () => { try { return JSON.parse(req.postData() ?? "null"); } catch { return null; } };
  const eqId = () => {
    const q = u.searchParams.get("id");
    return q !== null ? Number(q.startsWith("eq.") ? q.slice(3) : q) : null;
  };

  if (method !== "GET") writes.push({ method, path: u.pathname + (u.search || ""), body: body() });

  if (url.includes("/auth/v1/user"))
    return route.fulfill(json({ id: "11111111-1111-1111-1111-111111111111",
                                email: "owner@roro.ph", aud: "authenticated", role: "authenticated" }));
  if (url.includes("/rpc/search_materials")) return route.fulfill(json([]));
  if (url.includes("/rest/v1/profiles")) return route.fulfill(json([{ role: "owner" }]));
  if (url.includes("/rest/v1/import_batches")) return route.fulfill(json([]));

  if (url.includes("/rest/v1/purchases_flat")) return route.fulfill(json([...flat]));
  if (url.includes("/rest/v1/purchases")) { // bulk project rename: apply to the fixture rows
    const projQ = u.searchParams.get("project_name");
    if (projQ !== null && projQ.startsWith("ilike.")) {
      const old = projQ.slice(6).toLowerCase();
      for (const r of flat) {
        if ((r.project_name ?? "").toLowerCase() === old) r.project_name = String(body()?.project_name ?? r.project_name);
      }
    }
    return route.fulfill(noContent());
  }

  if (url.includes("/rest/v1/categories")) {
    if (method === "PATCH") {
      const row = cats.find((c) => c.id === eqId());
      if (row) Object.assign(row, body());
      return route.fulfill(noContent());
    }
    if (method === "DELETE") {
      const id = eqId();
      const used = materials.some((m) => m.category_id === id);
      if (used) return route.fulfill(fkViolation());
      const i = cats.findIndex((c) => c.id === id);
      if (i >= 0) cats.splice(i, 1);
      return route.fulfill(noContent());
    }
    return route.fulfill(json([...cats]));
  }

  if (url.includes("/rest/v1/materials")) {
    if (method === "PATCH") {
      const row = materials.find((m) => m.id === eqId());
      if (row) Object.assign(row, body());
      return route.fulfill(noContent());
    }
    if (method === "DELETE") {
      const id = eqId();
      const i = materials.findIndex((m) => m.id === id);
      if (i >= 0) materials.splice(i, 1);
      return route.fulfill(noContent());
    }
    return route.fulfill(json([...materials]));
  }

  if (url.includes("/rest/v1/material_aliases")) return route.fulfill(json([]));

  if (url.includes("/rest/v1/suppliers")) {
    if (method === "POST") {
      const b = body();
      const norm = String(b?.name ?? "").toUpperCase().replace(/\s+/g, " ").trim();
      let hit = suppliers.find((s) => s.name_norm === norm);
      if (!hit) { hit = { id: ++supSeq, name: b.name, name_norm: norm }; suppliers.push(hit); }
      return route.fulfill(json(wantsObject ? hit : [hit]), 201);
    }
    if (method === "PATCH") {
      const row = suppliers.find((s) => s.id === eqId());
      if (row) row.name = String(body()?.name ?? row.name);
      return route.fulfill(noContent());
    }
    if (method === "DELETE") {
      const i = suppliers.findIndex((s) => s.id === eqId());
      if (i >= 0) suppliers.splice(i, 1);
      return route.fulfill(noContent());
    }
    const normEq = u.searchParams.get("name_norm");
    if (normEq !== null) {
      const val = (normEq.startsWith("eq.") ? normEq.slice(3) : normEq);
      const hit = suppliers.find((s) => s.name_norm === val) ?? null;
      return route.fulfill(json(wantsObject ? hit : hit ? [hit] : []));
    }
    return route.fulfill(json([...suppliers]));
  }

  if (url.includes("/rest/v1/projects")) {
    if (method === "PATCH") {
      const row = projects.find((p) => p.id === eqId());
      if (row) {
        row.name = String(body()?.name ?? row.name);
        // name_norm is GENERATED ALWAYS in the real DB — regenerate the same way
        row.name_norm = row.name.toUpperCase().replace(/\s+/g, " ").trim();
      }
      return route.fulfill(noContent());
    }
    if (method === "DELETE") {
      const i = projects.findIndex((p) => p.id === eqId());
      if (i >= 0) projects.splice(i, 1);
      return route.fulfill(noContent());
    }
    if (method === "POST") return route.fulfill(json([{ id: 99 }], 201));
    return route.fulfill(json([...projects]));
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
  try { await page.goto(BASE + "/#/materials", { waitUntil: "domcontentloaded", timeout: 1500 }); up = true; }
  catch { await sleep(500); }
}
if (!up) { console.error("PREVIEW NOT UP"); process.exit(1); }
await page.waitForSelector('.card-head:text-is("Categories")', { timeout: 10000 });
await page.waitForSelector('.card-head:text-is("Suppliers")', { timeout: 10000 });

const results = [];
const ok = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
const card = (name) => page.locator(`.card:has(.card-head:text-is("${name}"))`);
const writesSince = async (n, probe) => {
  for (let i = 0; i < 60 && writes.length <= n; i++) await sleep(100);
  return writes.slice(n);
};

// ---- Suppliers card -----------------------------------------------------------
const supRows = () => card("Suppliers").locator("tbody tr").allTextContents();
let n0 = writes.length;
ok("suppliers listed with used counts",
  (await supRows()).join(" ").includes("HARDWARE A") &&
  (await supRows())[0]?.includes("2×") === true,
  JSON.stringify(await supRows()));

await card("Suppliers").locator('input[placeholder="e.g. SUNTRADE"]').fill("NEW CO");
await card("Suppliers").locator('button:has-text("Add supplier")').click();
await page.waitForSelector('.card:has(.card-head:text-is("Suppliers")) tbody tr:has-text("NEW CO")', { timeout: 10000 });
const supPosts = writes.slice(n0).filter((w) => w.method === "POST" && w.path.includes("/suppliers"));
ok("Add supplier POSTs the new name",
  supPosts.length === 1 && supPosts[0]?.body?.name === "NEW CO", JSON.stringify(supPosts));
ok("new supplier appears in the table",
  (await supRows()).some((t) => t.includes("NEW CO")), JSON.stringify(await supRows()));

// rename HARDWARE A → HARDWARE B (row 0 in mock order — pin by index:
// once the editor opens, the name lives in the input value, not the row text)
n0 = writes.length;
const supRowA = card("Suppliers").locator("tbody tr").nth(0);
await supRowA.locator('button[title="Rename supplier"]').click();
await supRowA.locator("input").fill("HARDWARE B");
await supRowA.locator('button[title="Save"]').click();
await writesSince(n0, "");
const supPatches = writes.slice(n0).filter((w) => w.method === "PATCH" && w.path.includes("/suppliers"));
ok("supplier rename PATCHes id=1 with the new name",
  supPatches.length === 1 && supPatches[0]?.path.includes("id=eq.1") &&
  supPatches[0]?.body?.name === "HARDWARE B", JSON.stringify(supPatches));
await sleep(400);
ok("table shows the renamed supplier",
  (await supRows()).some((t) => t.includes("HARDWARE B")), JSON.stringify(await supRows()));

// delete NEW CO
n0 = writes.length;
await card("Suppliers").locator("tbody tr", { hasText: "NEW CO" })
  .locator('button[title="Remove supplier"]').click();
await writesSince(n0, "");
const supDels = writes.slice(n0).filter((w) => w.method === "DELETE" && w.path.includes("/suppliers"));
ok("supplier delete DELETEs id=eq.3",
  supDels.length === 1 && supDels[0]?.path.includes("id=eq.3"), JSON.stringify(supDels));
await sleep(400);
ok("deleted supplier leaves the table",
  !(await supRows()).some((t) => t.includes("NEW CO")), JSON.stringify(await supRows()));

// ---- Categories card ----------------------------------------------------------
let catTexts = await card("Categories").locator("tbody tr").allTextContents();
ok("categories listed with particulars counts",
  catTexts.some((t) => t.includes("PVC Pipes & Fittings")) &&
  catTexts[2]?.includes("Painting") === true, JSON.stringify(catTexts));

// rename Cement → Masonry, unit bag → sack (row 1 in mock order; index-pinned)
n0 = writes.length;
const catRow = card("Categories").locator("tbody tr").nth(1);
await catRow.locator('button[title="Rename category"]').click();
await catRow.locator("input").first().fill("Masonry");
await catRow.locator("input").nth(1).fill("sack");
await catRow.locator('button[title="Save"]').click();
await writesSince(n0, "");
const catPatches = writes.slice(n0).filter((w) => w.method === "PATCH" && w.path.includes("/categories"));
ok("category edit PATCHes name + unit on id=4",
  catPatches.length === 1 && catPatches[0]?.path.includes("id=eq.4") &&
  catPatches[0]?.body?.name === "Masonry" && catPatches[0]?.body?.unit === "sack",
  JSON.stringify(catPatches));
await sleep(400);
catTexts = await card("Categories").locator("tbody tr").allTextContents();
ok("category row shows the new name/unit",
  catTexts.some((t) => t.includes("Masonry") && t.includes("sack")), JSON.stringify(catTexts));

// delete blocked while particulars exist (PVC Pipes & Fittings has 2)
n0 = writes.length;
await card("Categories").locator("tbody tr", { hasText: "PVC Pipes & Fittings" })
  .locator('button[title="Remove category"]').click();
await writesSince(n0, "");
const catDelTry = writes.slice(n0).filter((w) => w.method === "DELETE" && w.path.includes("/categories"));
ok("delete of a used category was attempted",
  catDelTry.length === 1 && catDelTry[0]?.path.includes("id=eq.3"), JSON.stringify(catDelTry));
await sleep(400);
const catBanner = await card("Categories").locator(".banner").textContent().catch(() => "");
ok("friendly banner explains the block (particulars still inside)",
  catBanner?.includes("still has particulars") === true, catBanner ?? "no banner");
ok("used category still listed",
  (await card("Categories").locator("tbody tr").allTextContents())
    .some((t) => t.includes("PVC Pipes & Fittings")));

// delete the empty Painting category
n0 = writes.length;
await card("Categories").locator("tbody tr", { hasText: "Painting" })
  .locator('button[title="Remove category"]').click();
await writesSince(n0, "");
const catDels = writes.slice(n0).filter((w) => w.method === "DELETE" && w.path.includes("/categories"));
ok("empty category delete succeeds (DELETE id=eq.9)",
  catDels.length === 1 && catDels[0]?.path.includes("id=eq.9"), JSON.stringify(catDels));
await sleep(400);
ok("empty category leaves the table",
  !(await card("Categories").locator("tbody tr").allTextContents()).some((t) => t.includes("Painting")));

// ---- Projects card: rename re-points ledger lines ------------------------------
// (Talisay sorts after MCDO → row 1; index-pinned for the same input-value reason)
n0 = writes.length;
const projRow = card("Projects").locator("tbody tr").nth(1);
await projRow.locator('button[title="Rename project"]').click();
await projRow.locator("input").fill("Talisay City");
await projRow.locator('button[title="Save"]').click();
await writesSince(n0, "");
// the ledger re-point fires after the catalog PATCH — wait for it specifically
for (let i = 0; i < 60 && !writes.slice(n0).some((w) => w.method === "PATCH" && w.path.includes("/purchases")); i++) await sleep(100);
const projPatches = writes.slice(n0).filter((w) => w.method === "PATCH" && w.path.includes("/projects"));
const linePatches = writes.slice(n0).filter((w) => w.method === "PATCH" && w.path.includes("/purchases"));
ok("project rename PATCHes id=2",
  projPatches.length === 1 && projPatches[0]?.path.includes("id=eq.2") &&
  projPatches[0]?.body?.name === "Talisay City", JSON.stringify(projPatches));
ok("ledger lines re-pointed (bulk project_name PATCH, ilike old name)",
  linePatches.length === 1 && linePatches[0]?.body?.project_name === "Talisay City" &&
  linePatches[0]?.path.includes("project_name=ilike.Talisay"), JSON.stringify(linePatches));
await sleep(400);
const projTexts = await card("Projects").locator("tbody tr").allTextContents();
ok("projects table shows ONE merged row with the rename + its used count",
  projTexts.length === 2 && projTexts[1]?.includes("Talisay City") &&
  projTexts[1]?.includes("1×") === true && !projTexts[1]?.includes("in ledger"),
  JSON.stringify(projTexts));

// ---- Particulars: inline edit + delete ----------------------------------------
const matRow = () => card("Suppliers").locator("..").locator("table").last();
const matCard = page.locator(".card").filter({ has: page.locator('th:has-text("Particular (")') });
n0 = writes.length;
await matCard.locator("tbody tr", { hasText: "PVC TEE" }).first()
  .locator('button[title="Edit particular"]').click();
const brandVal = await matCard.locator('label:has-text("Brand") input').inputValue();
const typeVal = await matCard.locator('label:has-text("Type") input').inputValue();
const sizeVal = await matCard.locator('label:has-text("Size") input').inputValue();
ok("edit row opens prefilled (brand/type/size)",
  brandVal === "MOLDEX" && typeVal === "PVC TEE" && sizeVal === "3X3",
  JSON.stringify([brandVal, typeVal, sizeVal]));
await matCard.locator('label:has-text("Degrees") input').fill("90");
await matCard.locator('label:has-text("Unit") input').fill("set");
await matCard.locator('button:has-text("Save")').click();
await writesSince(n0, "");
const matPatches = writes.slice(n0).filter((w) => w.method === "PATCH" && w.path.includes("/materials"));
ok("particular edit PATCHes all catalog fields on id=10",
  matPatches.length === 1 && matPatches[0]?.path.includes("id=eq.10") &&
  matPatches[0]?.body?.brand === "MOLDEX" && matPatches[0]?.body?.type === "PVC TEE" &&
  matPatches[0]?.body?.size_native === "3X3" && matPatches[0]?.body?.degrees === 90 &&
  matPatches[0]?.body?.unit === "set" && matPatches[0]?.body?.category_id === 3,
  JSON.stringify(matPatches));
await sleep(400);
ok("edited particular shows the new unit",
  (await matCard.locator("tbody tr").allTextContents())
    .some((t) => t.includes("PVC TEE") && t.includes("set")));

// delete CEMENT 40KG (usage 8 → confirm warns but proceeds)
n0 = writes.length;
await matCard.locator("tbody tr", { hasText: "CEMENT 40KG" })
  .locator('button[title="Remove particular"]').click();
await writesSince(n0, "");
const matDels = writes.slice(n0).filter((w) => w.method === "DELETE" && w.path.includes("/materials"));
ok("particular delete DELETEs id=eq.12",
  matDels.length === 1 && matDels[0]?.path.includes("id=eq.12"), JSON.stringify(matDels));
await sleep(400);
ok("deleted particular leaves the table",
  !(await matCard.locator("tbody tr").allTextContents()).some((t) => t.includes("CEMENT 40KG")));

console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
