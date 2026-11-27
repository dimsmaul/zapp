import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const key = "zapp.theme";
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  try {
    const value = localStorage.getItem(key);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme = getTheme()) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(key);
    else localStorage.setItem(key, theme);
  } catch {
    // storage can be blocked; the theme still applies for this page view
  }
  applyTheme(theme);
  for (const listener of listeners) listener();
}

export function useTheme() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getTheme,
    () => "system" as Theme,
  );
}
