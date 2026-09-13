import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1866, height: 950 } });
await page.goto("file:///C:/Users/Rizu/Desktop/Material%20Control/material-control-app/shots/layout-test.html",
  { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
await page.locator(".side-foot").screenshot({ path: "shots/footer-full.png" });
await page.click("#sideToggle");
await page.waitForTimeout(300);
await page.locator(".side-foot").screenshot({ path: "shots/footer-mini.png" });
console.log("saved footer-full.png + footer-mini.png");
await browser.close();
