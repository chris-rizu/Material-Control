// Second ground-truth pass: not just "is .si-pop in the DOM" but is it
// VISIBLE — bounding box inside the viewport, painted, on top. Also walks to
// Read-Only and repeats. Read-only checks, no writes.
import { chromium } from "playwright-core";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const ctx = browser.contexts()[0];
const page = ctx.pages()[0];
console.log("page url:", page.url());

const vis = await page.evaluate(() => ({
  visibilityState: document.visibilityState,
  innerWidth: innerWidth, innerHeight: innerHeight,
  dpr: devicePixelRatio,
}));
console.log("window:", JSON.stringify(vis));

async function probe(tabName) {
  await page.waitForSelector(".pp-table tbody tr", { timeout: 30000 });
  const link = page.locator(".pp-table tbody tr .si-link").first();
  console.log(`[${tabName}] clicking si-link:`, JSON.stringify(await link.textContent()));
  await link.click();
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const pop = document.querySelector(".si-pop");
    if (!pop) return { found: false };
    const cs = getComputedStyle(pop);
    const r = pop.getBoundingClientRect();
    const atPoint = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      found: true,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      inViewport: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      position: cs.position, zIndex: cs.zIndex, display: cs.display,
      visibility: cs.visibility, opacity: cs.opacity,
      offsetParent: pop.offsetParent ? pop.offsetParent.className || pop.offsetParent.tagName : null,
      topElementAtCenter: atPoint ? (atPoint.className || atPoint.tagName) : null,
      text: pop.textContent.slice(0, 120),
    };
  });
  console.log(`[${tabName}] popover:`, JSON.stringify(info, null, 1));
  // close it for the next tab
  const bd = page.locator(".pop-backdrop");
  if (await bd.count()) { await bd.click({ force: true }).catch(() => {}); await page.waitForTimeout(300); }
}

// land on Purchases whatever tab the app booted to (it restores the last route;
// "/" is the Purchases home)
await page.goto("file:///C:/Users/Rizu/AppData/Local/Programs/Material%20Control/resources/app.asar/dist/index.html");
await page.waitForTimeout(1500);

await probe("Purchases");
// walk to Read-Only via the app's own nav
const ro = page.locator("nav >> text=Read-Only").first();
if (await ro.count()) {
  await ro.click();
  await page.waitForTimeout(800);
  await probe("Read-Only");
} else {
  console.log("Read-Only nav link not found — nav items:");
  console.log(await page.evaluate(() =>
    [...document.querySelectorAll("nav a, aside a")].map((a) => a.textContent?.trim())));
}
await browser.close();
console.log("VISIBILITY PROBE DONE");
