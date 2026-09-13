// Screenshot driver: system Edge via playwright-core (no browser download).
// Usage: node scripts/screenshot.mjs [url] [outfile]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:5173/login";
const out = process.argv[3] ?? "shots/login.png";
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1866, height: 950 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(600); // let fonts/transitions settle

await page.screenshot({ path: out });
console.log(`saved ${out}`);
console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "no console errors");
await browser.close();
