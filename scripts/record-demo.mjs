// Records the product demo: drives the demo harness + real login page,
// captures frames at 24 fps, then assembles them into an MP4 with ffmpeg.
// Usage: node scripts/record-demo.mjs   →  "Material Control Demo.mp4"
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const FPS = 24;
const DIR = "shots/demo-frames";
const OUT = "C:\\Users\\Rizu\\Desktop\\Material Control\\Material Control Demo.mp4";
const DEMO = "file:///C:/Users/Rizu/Desktop/Material%20Control/material-control-app/shots/demo.html";
const LOGIN = "http://localhost:5173/#/login";

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

let n = 0;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

async function shot() {
  n++;
  await page.screenshot({
    path: `${DIR}/f${String(n).padStart(4, "0")}.jpeg`,
    type: "jpeg",
    quality: 88,
  });
}
async function hold(sec) {
  const frames = Math.max(1, Math.round(sec * FPS));
  for (let i = 0; i < frames; i++) await shot();
}
async function holdWhile(fn, sec) {
  const frames = Math.max(1, Math.round(sec * FPS));
  for (let i = 0; i < frames; i++) {
    await fn(i / frames);
    await shot();
  }
}

// ---- 1. title card ---------------------------------------------------------
await page.goto(DEMO, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(500);
await page.evaluate(() => demo.overlay(true));
await hold(2.2);
await holdWhile((p) => page.evaluate((q) => demo.overlayOpacity(1 - q), p), 0.35);
await page.evaluate(() => demo.overlay(false));

// ---- 2. real login page ----------------------------------------------------
await page.goto(LOGIN, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1800);
await hold(2.0);

// ---- 3. purchases, dark, full table ---------------------------------------
await page.goto(DEMO, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
await page.evaluate(() => demo.caption("Every purchase — line by line, totals calculated for you"));
await hold(2.6);

// ---- 4. typing + predictive suggestions ------------------------------------
await page.evaluate(() => demo.caption("Start typing — the system predicts the material and the last price you paid"));
const text = "MOLDEX WYE";
const dd = page.locator("#demoDD");
for (let i = 1; i <= text.length; i++) {
  const v = text.slice(0, i);
  await page.evaluate((t) => { document.getElementById("demoParticulars").value = t; }, v);
  if (i >= 6) await dd.evaluate((el) => (el.style.display = "block"));
  await shot();
  await shot();
}
await hold(0.5);
// highlight first suggestion, then accept it
await holdWhile(() => {}, 0.3);
await dd.evaluate((el) => (el.style.display = "none"));
await page.evaluate(() => {
  document.getElementById("demoParticulars").value = "MOLDEX PVC WYE 6X6";
  document.getElementById("demoPrice").value = "1330";
  document.getElementById("demoAmount").textContent = "₱13,300.00";
});
await page.evaluate(() => demo.caption("Accepted — the price and totals fill themselves in"));
await hold(1.2);
await page.evaluate(() => demo.caption("Hit Add — the row lands in your ledger, newest first"));
await page.click("#demoAdd");
await hold(0.3);
await page.evaluate(() => demo.addRow());
await hold(1.2);
await page.evaluate(() => {
  demo.clearDraft();
  demo.caption("Saved — counts and grand total update automatically");
});
await hold(1.4);

// ---- 5. supplier typo guard -------------------------------------------------
await page.evaluate(() => demo.caption("A typo can’t create a phantom supplier — the app asks first"));
const sup = "CEBU LUCKY MACH";
for (let i = 1; i <= sup.length; i++) {
  await page.evaluate((t) => { document.getElementById("demoSupplier").value = t; }, sup.slice(0, i));
  await shot();
}
await page.evaluate(() => { document.getElementById("demoBanner").style.display = "block"; });
await hold(2.0);
await page.evaluate(() => {
  document.getElementById("demoBanner").style.display = "none";
  document.getElementById("demoSupplier").value = "CEBU LUCKY MACHINERY, INC.";
});
await page.evaluate(() => demo.caption("One click — the right supplier, no duplicates"));
await hold(1.2);

// ---- 6. inline editing -------------------------------------------------------
await page.evaluate(() => demo.caption("Spot a mistake? Click the pencil — fix it right in the table"));
const firstActions = page.locator("tbody tr").first().locator("td.actions");
await firstActions.scrollIntoViewIfNeeded();
await page.hover("tbody tr:nth-child(1) td.actions");
await hold(1.6);

// ---- 7. rail minimize / restore ---------------------------------------------
await page.evaluate(() => demo.caption("Minimize the stats panel when you want the full table"));
await page.click("#railMin");
await holdWhile(() => {}, 0.5);
await hold(1.2);
await page.click("#railTab");
await holdWhile(() => {}, 0.5);
await hold(0.6);

// ---- 8. sidebar mini ---------------------------------------------------------
await page.evaluate(() => demo.caption("Collapse the menu — everything stays one click away"));
await page.click("#sideToggle");
await holdWhile(() => {}, 0.5);
await hold(1.4);
await page.click("#sideToggle");
await holdWhile(() => {}, 0.5);

// ---- 9. light theme -----------------------------------------------------------
await page.evaluate(() => demo.caption("Light and dark — your choice, remembered"));
await page.click("#themeToggle");
await holdWhile(() => {}, 0.4);
await hold(2.4);

// ---- 10. donut + totals hold in light ----------------------------------------
await page.evaluate(() => demo.caption("Live totals and category breakdown — always up to date"));
await hold(2.2);

// ---- 11. closing card ----------------------------------------------------------
await page.evaluate(() => demo.overlay(true, "npm run app — and make it yours"));
await hold(2.4);

await browser.close();

// ---- assemble -----------------------------------------------------------------
console.log(`frames: ${n} (${(n / FPS).toFixed(1)}s at ${FPS} fps)`);
execFileSync("ffmpeg", [
  "-y", "-framerate", String(FPS), "-i", `${DIR}/f%04d.jpeg`,
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-movflags", "+faststart",
  OUT,
], { stdio: "pipe" });
console.log(`video: ${OUT}`);
