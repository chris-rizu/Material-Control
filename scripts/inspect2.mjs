import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1124, height: 800 } });
await page.goto("file:///C:/Users/Rizu/Desktop/Material%20Control/material-control-app/shots/layout-test.html",
  { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
const r = await page.evaluate(() => {
  const g = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return "(none)";
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return { h: Math.round(rect.height), w: Math.round(rect.width), top: Math.round(rect.top),
      display: cs.display, dir: cs.flexDirection, overflow: cs.overflow, minH: cs.minHeight,
      flex: cs.flex, maxH: cs.maxHeight };
  };
  return {
    docHeight: document.documentElement.scrollHeight,
    shell: g(".shell"), maincol: g(".main-col"), content: g(".content"),
    cols: g(".cols"), main: g(".main"), ppCard: g(".pp-card"),
    ppDraft: g(".pp-draft"), ppScroll: g(".pp-scroll"), ppFoot: g(".pp-foot"), rail: g(".rail"),
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
