// Layout-verification screenshot: injects a structurally-valid LOCAL session
// into localStorage so the authenticated shell renders. All data fetches fail
// (fake token) — that's fine, we only need the layout geometry.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1720, height: 950 } });
await ctx.addInitScript(() => {
  const session = {
    access_token: "fake.token.value",
    token_type: "bearer",
    expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    user: {
      id: "00000000-0000-0000-0000-000000000000",
      aud: "authenticated",
      role: "authenticated",
      email: "preview@roro.local",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
  localStorage.setItem("sb-ksztevlqbckdyhheqzif-auth-token", JSON.stringify(session));
});

const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);
await page.screenshot({ path: "shots/purchases-preview.png" });
console.log("saved shots/purchases-preview.png");
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "no page errors");
await browser.close();
