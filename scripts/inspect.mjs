// DOM/CSS inspector for the layout harness — reports what the browser ACTUALLY
// parsed and computed, so we debug from evidence, not guesses.
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1720, height: 950 } });
await page.goto("file:///C:/Users/Rizu/Desktop/Material%20Control/material-control-app/shots/layout-test.html",
  { waitUntil: "domcontentloaded" });
await page.waitForTimeout(500);

const report = await page.evaluate(() => {
  const out = {};
  out.stylesheets = [...document.styleSheets].map((s) => {
    let n = 0; let pp = []; let cols = null;
    try {
      for (const r of s.cssRules) {
        n++;
        const t = r.cssText || "";
        if (t.includes("pp-scroll")) pp.push(t.slice(0, 90));
        if (t.startsWith(".cols")) cols = t.slice(0, 90);
      }
    } catch (e) { n = -1; }
    return { rules: n, ppScrollRules: pp, colsRule: cols };
  });
  const q = (sel) => document.querySelector(sel);
  const cs = (sel, prop) => { const el = q(sel); return el ? getComputedStyle(el)[prop] : "(none)"; };
  out.colsDisplay = cs(".cols", "display");
  out.railWidth = cs(".rail", "width");
  out.scrollExists = !!q(".pp-scroll");
  out.scrollOverflowY = cs(".pp-scroll", "overflowY");
  out.scrollHeight = q(".pp-scroll")?.scrollHeight;
  out.clientHeight = q(".pp-scroll")?.clientHeight;
  const th = q(".pp-table thead th");
  out.theadTh = th ? {
    position: getComputedStyle(th).position,
    top: getComputedStyle(th).top,
    height: th.offsetHeight,
    text: th.textContent,
    bg: getComputedStyle(th).backgroundColor,
  } : "(no thead th found)";
  out.draftTableWidth = q(".pp-draft table")?.getBoundingClientRect().width;
  out.cardWidth = q(".pp-card")?.getBoundingClientRect().width;
  return out;
});

console.log(JSON.stringify(report, null, 1));
await browser.close();
