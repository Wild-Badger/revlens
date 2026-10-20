"use client";

import { useEffect, useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("revlens-theme-change", onChange);
  return () => window.removeEventListener("revlens-theme-change", onChange);
}

function setTheme(light: boolean) {
  document.documentElement.dataset.theme = light ? "light" : "dark";
  window.dispatchEvent(new Event("revlens-theme-change"));
}

export function ThemeToggle() {
  const light = useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme === "light", () => false);

  useEffect(() => {
    // ponytail: one explicit saved preference; dark is the default on every device.
    try {
      setTheme(localStorage.getItem("revlens-theme") === "light");
    } catch { /* Preserve the current theme when browser storage is disabled. */ }
  }, []);

  function toggleTheme() {
    const nextLight = !light;
    setTheme(nextLight);
    try { localStorage.setItem("revlens-theme", nextLight ? "light" : "dark"); } catch { /* The control still works when browser storage is disabled. */ }
  }

  return (
    <button type="button" onClick={toggleTheme} aria-pressed={light}
      className="min-h-10 shrink-0 rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
      aria-label="Light theme">
      {light ? "Dark theme" : "Light theme"}
    </button>
  );
}
