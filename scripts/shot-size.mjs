// Screenshot at a specific viewport: node scripts/shot-size.mjs <url> <out> <width> <height>
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:5173/login";
const out = process.argv[3] ?? "shots/shot.png";
const w = Number(process.argv[4] ?? 1866);
const h = Number(process.argv[5] ?? 950);
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: w, height: h } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(700);
await page.screenshot({ path: out });
console.log(`saved ${out} at ${w}x${h}`);
await browser.close();
