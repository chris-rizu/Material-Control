import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1866, height: 950 } });
await page.goto("file:///C:/Users/Rizu/Desktop/Material%20Control/material-control-app/shots/layout-test.html",
  { waitUntil: "domcontentloaded" });
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/rail-open.png" });
await page.click(".rail-min");
await page.waitForTimeout(300);
await page.screenshot({ path: "shots/rail-collapsed.png" });
const state = await page.evaluate(() => ({
  tabVisible: !!document.querySelector(".rail-tab") && document.querySelector(".rail-tab").style.display !== "none",
  railHidden: (document.querySelector(".rail")?.style.display === "none"),
  mainWidth: Math.round(document.querySelector(".cols .main")?.getBoundingClientRect().width ?? 0),
}));
console.log(JSON.stringify(state));
await browser.close();
