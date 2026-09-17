// Ground-truth check of the INSTALLED app: connect over CDP, click an SI#
// link in the live ledger, and report whether the popover opens, what it
// says, and any console/page errors. Read-only — no writes are performed.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const ctx = browser.contexts()[0];
const page = ctx.pages()[0];
console.log("page url:", page.url());

page.on("console", (m) => { if (m.type() === "error") console.log("console.error:", m.text()); });
page.on("pageerror", (e) => console.log("pageerror:", String(e)));

await page.waitForSelector(".pp-table tbody tr", { timeout: 30000 });
const rows = await page.locator(".pp-table tbody tr").count();
console.log("ledger rows:", rows);

const link = page.locator(".pp-table tbody tr .si-link").first();
console.log("first si-link text:", JSON.stringify(await link.textContent()));
console.log("si-pop before click:", await page.locator(".si-pop").count());
await link.click();
await page.waitForTimeout(1200);
console.log("si-pop after click:", await page.locator(".si-pop").count());
const pop = page.locator(".si-pop");
if (await pop.count()) {
  console.log("popover text:", (await pop.textContent()).slice(0, 500));
}
console.log("backdrop after click:", await page.locator(".pop-backdrop").count());
await page.screenshot({ path: join(OUT, "live-popover-check.png") });
console.log("shot saved: docs/live-popover-check.png");
await browser.close();
