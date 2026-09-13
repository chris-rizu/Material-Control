import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1866, height: 950 } });
await page.goto("file:///C:/Users/Rizu/Desktop/Material%20Control/material-control-app/shots/layout-test.html",
  { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
const r = await page.evaluate(() => {
  const htmlScheme = getComputedStyle(document.documentElement).colorScheme;
  const sel = document.querySelector(".pp-seg select");
  const opt = sel ? sel.querySelector("option") : null;
  return {
    htmlColorScheme: htmlScheme,
    selectColor: sel ? getComputedStyle(sel).color : "(none)",
    optionBackground: opt ? getComputedStyle(opt).backgroundColor : "(none)",
    optionColor: opt ? getComputedStyle(opt).color : "(none)",
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
