// Read-only live check: the installed app (launched with
// --remote-debugging-port=9333) shows the new Edit affordance on real
// receipt rows. Nothing is clicked that mutates data — Edit is opened and
// immediately cancelled.
import { chromium } from "playwright-core";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("index.html")) ?? ctx.pages()[0];
console.log("page:", page.url().slice(0, 80));

await page.waitForSelector(".pp-table tbody tr", { timeout: 20000 });

// go to the Receipts tab via the sidebar
await page.locator('.sidebar .nav-item[title="Receipts"]').click();
await page.waitForSelector(".rc-table tbody tr", { timeout: 20000 });

const rows = await page.locator(".rc-table tbody tr").count();
const editBtns = await page.locator('button[title="Edit receipt filing"]').count();
console.log(`receipt rows: ${rows}, Edit buttons: ${editBtns}`);

// open the editors on the first row and immediately cancel
const first = page.locator(".rc-table tbody tr").first();
await first.locator('button[title="Edit receipt filing"]').click();
const hasDate = await first.locator('input[type="date"]').count();
const hasSi = await first.locator(".si-box input").count();
const hasSel = await first.locator("select").count();
console.log(`editors on row: date=${hasDate} si=${hasSi} supplier=${hasSel}`);
const siVal = await first.locator(".si-box input").inputValue().catch(() => "?");
await first.locator('button[title="Cancel re-filing"]').click();
await page.waitForTimeout(300);
const backToText = await page.locator(".rc-table .si-box").count();
console.log(`row SI value was "${siVal}"; editors after cancel: ${backToText} (0 = clean)`);

const pass = rows > 0 && editBtns === rows && hasDate === 1 && hasSi === 1 && hasSel === 1 && backToText === 0;
console.log(pass ? "LIVE CHECK PASS" : "LIVE CHECK FAIL");
await browser.close();
process.exit(pass ? 0 : 1);
