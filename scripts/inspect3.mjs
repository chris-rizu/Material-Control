import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1866, height: 950 } });
await page.goto("file:///C:/Users/Rizu/Desktop/Material%20Control/material-control-app/shots/layout-test.html",
  { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
const r = await page.evaluate(() => {
  const aside = document.querySelector(".sidebar");
  const cs = aside ? getComputedStyle(aside) : null;
  let ruleCount = 0, sidebarRule = null, sheetErrors = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        ruleCount++;
        if (rule.selectorText && rule.selectorText.includes(".sidebar") && !sidebarRule) {
          sidebarRule = rule.cssText.slice(0, 200);
        }
      }
    } catch (e) { sheetErrors.push(String(e)); }
  }
  return {
    asideExists: !!aside,
    classes: aside?.className,
    bg: cs?.backgroundColor,
    width: cs?.width,
    display: cs?.display,
    ruleCount,
    sidebarRule,
    sheetErrors,
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
