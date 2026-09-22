import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { version } from "./package.json";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // relative asset paths so the built app also works inside Electron (file://)
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(version) },
});
