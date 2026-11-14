export type ColorTheme = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "madeof.theme";

export function readStoredTheme(): ColorTheme {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function writeStoredTheme(theme: ColorTheme): void {
  if (typeof window === "undefined") return;
  if (theme === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
  else window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function applyTheme(theme: ColorTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function nextTheme(theme: ColorTheme): ColorTheme {
  if (theme === "system") return "light";
  if (theme === "light") return "dark";
  return "system";
}
