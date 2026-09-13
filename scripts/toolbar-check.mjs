import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1124, height: 800 } });
await page.goto("file:///C:/Users/Rizu/Desktop/Material%20Control/material-control-app/shots/layout-test.html",
  { waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);
const info = await page.evaluate(() => {
  const segs = [...document.querySelectorAll(".pp-toolbar .pp-seg select")].map(s => s.options[0].text);
  const toolbar = document.querySelector(".pp-toolbar");
  const rect = toolbar.getBoundingClientRect();
  return { segments: segs, toolbarWidth: Math.round(rect.width), toolbarHeight: Math.round(rect.height) };
});
console.log(JSON.stringify(info));
const toolbar = page.locator(".pp-toolbar");
await toolbar.screenshot({ path: "shots/toolbar-narrow.png" });
console.log("saved shots/toolbar-narrow.png");
await browser.close();
