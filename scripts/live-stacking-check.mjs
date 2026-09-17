// Third ground-truth pass: WHY does the backdrop hit-test above the popover?
// 1) scan .si-pop's ancestor chain for stacking-context creators,
// 2) real-click "View the filed photo" — if the backdrop eats it, the popover
//    closes instead of opening the viewer,
// 3) same popover check on Read-Only. Read-only clicks only (viewer open is
//    harmless; close it after).
import { chromium } from "playwright-core";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const ctx = browser.contexts()[0];
const page = ctx.pages()[0];

// open the popover first (it starts closed)
await page.waitForSelector(".pp-table tbody tr", { timeout: 30000 });
await page.locator(".pp-table tbody tr .si-link").first().click();
await page.waitForSelector(".si-pop", { timeout: 8000 });

const scan = await page.evaluate(() => {
  const out = { zoom: getComputedStyle(document.body).zoom, htmlZoom: getComputedStyle(document.documentElement).zoom,
                chain: [] };
  let el = document.querySelector(".si-pop");
  if (!el) return { ...out, chain: ["NO POPOVER OPEN"] };
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    const ctxCreators = [];
    if (cs.position !== "static" && cs.zIndex !== "auto") ctxCreators.push(`pos+zi:${cs.zIndex}`);
    if (cs.transform !== "none") ctxCreators.push("transform");
    if (cs.filter !== "none") ctxCreators.push("filter");
    if (Number(cs.opacity) < 1) ctxCreators.push(`opacity:${cs.opacity}`);
    if (cs.willChange && cs.willChange !== "auto") ctxCreators.push(`will-change:${cs.willChange}`);
    if ((cs.backdropFilter ?? "none") !== "none") ctxCreators.push("backdrop-filter");
    if (cs.zoom && cs.zoom !== "1") ctxCreators.push(`zoom:${cs.zoom}`);
    if (ctxCreators.length) out.chain.push(`${el.tagName}.${String(el.className).slice(0, 40)} -> ${ctxCreators.join(",")}`);
    el = el.parentElement;
  }
  const pop = document.querySelector(".si-pop");
  const bd = document.querySelector(".pop-backdrop");
  out.popZ = getComputedStyle(pop).zIndex;
  out.bdZ = bd ? getComputedStyle(bd).zIndex : null;
  const r = pop.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 30);
  out.hitAtTop = hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null;
  return out;
});
console.log(JSON.stringify(scan, null, 1));

// real input click on a popover button: viewer opens = clicks reach it;
// popover closes with no viewer = the backdrop ate the click
const btn = page.locator('.si-pop button:has-text("View the filed photo")');
console.log("btn count:", await btn.count());
if (await btn.count()) {
  await btn.click({ timeout: 8000 }).then(() => console.log("click: dispatched"))
    .catch((e) => console.log("click FAILED:", String(e).slice(0, 200)));
  await page.waitForTimeout(800);
  console.log("modal-card after click:", await page.locator(".modal-card").count(),
              "| si-pop after click:", await page.locator(".si-pop").count());
  const close = page.locator(".rv-cap .iconbtn");
  if (await close.count()) { await close.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); }
}
console.log("STACKING PROBE DONE");
await browser.close();
