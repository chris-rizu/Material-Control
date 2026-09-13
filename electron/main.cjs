// Material Control — Electron main process.
// Loads the built app from dist/ (npm run app), or the Vite dev server when
// it's running (npm run app:dev alongside npm run dev).
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0b1524",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "public", "logo.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // open any external link in the default browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
    return;
  }

  const distIndex = path.join(__dirname, "..", "dist", "index.html");
  if (fs.existsSync(distIndex)) {
    win.loadFile(distIndex);
  } else {
    // no build yet — fall back to the dev server, else tell the user what to do
    win
      .loadURL("http://localhost:5173")
      .catch(() =>
        win.loadURL(
          "data:text/html," +
            encodeURIComponent(
              "<body style='font-family:sans-serif;background:#0b1524;color:#fff;display:grid;place-items:center;height:100vh'>" +
                "<div style='text-align:center'><h2>Not built yet</h2><p>Run <code>npm run app</code> once to build and start the desktop app.</p></div></body>",
            ),
        ),
      );
  }
}

app.setAppUserModelId("ph.roro.materialcontrol");
Menu.setApplicationMenu(null); // clean window — the app has its own menus

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
