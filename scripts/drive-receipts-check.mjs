// Verifies the app side of the receipt-photo Drive backup (plans site's
// api/drive-receipt.js — its own relay/skip logic is checked there): the
// Settings backup button, the per-photo POSTs (token, Drive filenames, data
// URLs), already-there skips, tolerated failures, and the not-configured
// message. Usage: npm run build && npx vite preview --port 4188 &
//        then: node scripts/drive-receipts-check.mjs
import { chromium } from "playwright-core";
import { setTimeout as sleep } from "node:timers/promises";

const REF = "ksztevlqbckdyhheqzif";
const BASE = "http://localhost:4188";
const DRIVE_URL = "https://material-control-plans.vercel.app/api/drive-receipt";
// a tiny valid JPEG (1x1)
const JPEG_B64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmAA//9k=";

const receipts = [
  { id: 1, purchase_date: "2026-09-10", si_no: "SI# 292713", supplier_id: 1,
    storage_path: "2026-09-10/si-292713_1_1.jpg", file_name: "r1.jpg", mime_type: "image/jpeg",
    file_size: 100, uploaded_by: null, created_at: "2026-09-10T02:00:00Z" },
  { id: 2, purchase_date: "2026-09-09", si_no: "", supplier_id: 2,
    storage_path: "2026-09-09/si-none_2_2.jpg", file_name: "r2.jpg", mime_type: "image/jpeg",
    file_size: 100, uploaded_by: null, created_at: "2026-09-09T02:00:00Z" },
  { id: 3, purchase_date: "2026-09-08", si_no: "SI# 100", supplier_id: null,
    storage_path: "2026-09-08/si-100_0_3.jpg", file_name: "r3.jpg", mime_type: "image/jpeg",
    file_size: 100, uploaded_by: null, created_at: "2026-09-08T02:00:00Z" },
];
const suppliers = [
  { id: 1, name: "HARDWARE A", name_norm: "HARDWARE A" },
  { id: 2, name: "CEMENT CO", name_norm: "CEMENT CO" },
];
const NAMES = [
  "2026-09-10 - SI# 292713 - HARDWARE A.jpg",
  "2026-09-09 - no invoice # - CEMENT CO.jpg",
  "2026-09-08 - SI# 100 - no supplier.jpg",
];

const json = (body, status = 200) => ({
  status, contentType: "application/json",
  headers: { "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});

async function routeSupabase(route) {
  const url = route.request().url();
  if (url.includes("/rest/v1/receipts")) return route.fulfill(json(receipts));
  if (url.includes("/rest/v1/suppliers")) return route.fulfill(json(suppliers));
  if (url.includes("/rest/v1/profiles")) return route.fulfill(json([{ role: "owner" }]));
  if (url.includes("/auth/v1/user"))
    return route.fulfill(json({ id: "11111111-1111-1111-1111-111111111111",
                                email: "owner@roro.ph", aud: "authenticated", role: "authenticated" }));
  if (url.includes("/storage/v1/object/receipts/"))
    return route.fulfill({ status: 200, contentType: "image/jpeg",
                           body: Buffer.from(JPEG_B64, "base64") });
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

// how each POST is answered, in order; the last mode sticks for extra posts
let script = ["ok", "skip", "fail"];
const posts = [];
await ctx.route(DRIVE_URL, (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: {
    "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS" } });
  posts.push({ auth: req.headers()["authorization"], body: JSON.parse(req.postData() ?? "{}") });
  const mode = script.length > 1 ? script.shift() : script[0];
  if (mode === "ok") return route.fulfill(json({ id: `drive-${posts.length}` }));
  if (mode === "skip") return route.fulfill(json({ id: `drive-${posts.length}`, skipped: true }));
  if (mode === "fail") return route.fulfill(json({ error: "relay", detail: "boom" }), 500);
  return route.fulfill(json({ error: "not_configured" }), 501);
});

let up = false;
for (let i = 0; i < 40 && !up; i++) {
  try { await page.goto(`${BASE}/#/settings`, { waitUntil: "domcontentloaded", timeout: 1500 }); up = true; }
  catch { await sleep(500); }
}
if (!up) { console.error("PREVIEW NOT UP"); process.exit(1); }
await page.waitForSelector('button:has-text("Back up receipt photos now")', { timeout: 10000 });

const results = [];
const ok = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);

const btn = page.locator('button:has-text("Back up receipt photos now")');
ok("the backup button is on Settings", (await btn.count()) === 1);

// waitForFunction's rAF polling never fires in this headless run, so poll the
// banner from Node instead. The regexes are exact enough that a stale banner
// from the previous run can't satisfy the next wait.
const waitBanner = async (re, timeout = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const texts = await page.locator(".banner").allInnerTexts();
    if (texts.some((t) => re.test(t))) return;
    if (Date.now() - t0 > timeout)
      throw new Error(`banner never matched ${re}: ${JSON.stringify(texts)}`);
    await sleep(300);
  }
};

// 1st run: 1 copied, 1 already there, 1 fails → the banner says all three
await btn.click();
await waitBanner(/Backed up 1 photo to Google Drive — 1 already there, 1 failed/);
ok("one POST per receipt photo", posts.length === 3, String(posts.length));
ok("sent with the signed-in Supabase token", posts.every((p) => p.auth === "Bearer fake-access"));
ok("Drive filenames are date - invoice - supplier",
  posts[0]?.body.name === NAMES[0] && posts[1]?.body.name === NAMES[1] && posts[2]?.body.name === NAMES[2],
  posts.map((p) => p.body.name).join(" | "));
ok("photos sent as image/jpeg data URLs",
  posts.every((p) => p.body.contentType === "image/jpeg" && String(p.body.data).startsWith("data:image/jpeg;base64,")));
const banner1 = await page.locator(".banner").innerText();
ok("banner counts copied / skipped / failed",
  /Backed up 1 photo to Google Drive — 1 already there, 1 failed/.test(banner1), banner1);

// 2nd run: Drive has everything → every photo counted as already there
posts.length = 0;
script = ["skip"];
await btn.click();
await waitBanner(/Backed up 0 photos to Google Drive — 3 already there\./);
ok("re-run: every photo POSTed again and counted as already there",
  posts.length === 3 && /Backed up 0 photos to Google Drive — 3 already there\./.test(await page.locator(".banner").innerText()),
  (await page.locator(".banner").innerText()));

// server not configured → a clear message
posts.length = 0;
script = ["notconf"];
await btn.click();
await waitBanner(/isn't set up/);
ok("unconfigured server → explains it", /isn't set up/.test(await page.locator(".banner").innerText()));

console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
