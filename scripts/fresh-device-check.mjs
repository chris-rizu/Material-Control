// A brand-new device: no stored session at all. The login screen must appear.
import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "msedge", headless: true });
const p = await b.newPage();
await p.goto("http://localhost:4188/");
await p.waitForTimeout(6000);
const txt = (await p.textContent("body")).trim().slice(0, 80);
const login = await p.locator("input[type=password]").count();
console.log(login ? "PASS  fresh device reaches the sign-in screen" : `FAIL  fresh device stuck — screen says: "${txt}"`);
await b.close();
process.exit(login ? 0 : 1);
