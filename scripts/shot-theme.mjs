// Screenshot the layout harness in a given theme: node scripts/shot-theme.mjs <light|dark> <outfile>
import { chromium } from "playwright-core";

const theme = process.argv[2] ?? "light";
const out = process.argv[3] ?? `shots/theme-${theme}.png`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1866, height: 950 } });
await page.goto(
  "file:///C:/Users/Rizu/Desktop/Material%20Control/material-control-app/shots/layout-test.html",
  { waitUntil: "domcontentloaded" },
);
await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
await page.waitForTimeout(500);
await page.screenshot({ path: out });
console.log(`saved ${out} (${theme})`);
await browser.close();
