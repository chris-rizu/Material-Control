// Theme state: "dark" (navy chrome + dark content, the original look) or
// "light" (white sidebar/header + light content). Persisted per browser.

export type Theme = "light" | "dark";
const KEY = "mc-theme";

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode — theme just won't persist */
  }
}
