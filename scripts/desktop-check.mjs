// Desktop-app verification: launches the real Electron window, screenshots it,
// reports the page state, then closes it.
import { _electron } from "playwright-core";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronPath = require("electron"); // path to the electron binary

const app = await _electron.launch({
  executablePath: electronPath,
  args: ["."],
});
const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded");
await win.waitForTimeout(2500); // let React + Supabase client settle

const state = await win.evaluate(() => ({
  title: document.title,
  hasLoginCard: !!document.querySelector(".login-card"),
  hasAppShell: !!document.querySelector(".shell"),
  bodyText: document.body.innerText.slice(0, 120),
}));
await win.screenshot({ path: "shots/desktop-app.png" });
console.log(JSON.stringify(state, null, 1));
console.log("saved shots/desktop-app.png");

await app.close();
