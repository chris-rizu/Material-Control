import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1866, height: 950 } });
await page.goto("file:///C:/Users/Rizu/Desktop/Material%20Control/material-control-app/shots/layout-test.html",
  { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
await page.click(".rail-min");
await page.waitForTimeout(400);
await page.screenshot({ path: "shots/rail-hidden-gutter.png" });
console.log("saved shots/rail-hidden-gutter.png");
await browser.close();
