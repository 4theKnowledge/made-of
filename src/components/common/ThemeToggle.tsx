"use client";

import { useEffect, useState } from "react";
import {
  applyTheme,
  nextTheme,
  readStoredTheme,
  writeStoredTheme,
  type ColorTheme,
} from "@/lib/theme";

function themeLabel(theme: ColorTheme): string {
  if (theme === "light") return "Light";
  if (theme === "dark") return "Dark";
  return "System";
}

function ThemeIcon({ theme }: { theme: ColorTheme }) {
  if (theme === "light") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
      </svg>
    );
  }
  if (theme === "dark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16" style={{ fill: "currentColor" }} />
    </svg>
  );
}

export function useThemeToggle() {
  const [theme, setTheme] = useState<ColorTheme>("system");

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  const cycle = () => {
    const next = nextTheme(theme);
    writeStoredTheme(next);
    applyTheme(next);
    setTheme(next);
  };

  return { theme, cycle };
}

export function ThemeToggle({
  className,
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { theme, cycle } = useThemeToggle();
  return (
    <button
      type="button"
      className={className ?? "themeToggle"}
      onClick={cycle}
      aria-label={`Appearance: ${themeLabel(theme)}. Click to change.`}
      title={`Appearance: ${themeLabel(theme)}`}
    >
      {showLabel ? `Theme: ${themeLabel(theme)}` : <ThemeIcon theme={theme} />}
    </button>
  );
}

export function ThemeToggleRow({
  onActivate,
  className,
  showSubtitle = true,
}: {
  onActivate?: () => void;
  className?: string;
  showSubtitle?: boolean;
}) {
  const { theme, cycle } = useThemeToggle();
  return (
    <button
      type="button"
      className={className ?? "cbhm"}
      onClick={() => {
        cycle();
        onActivate?.();
      }}
      aria-label={`Appearance: ${themeLabel(theme)}. Click to change.`}
    >
      <ThemeIcon theme={theme} />
      <span className="nm">
        <b className="t">Appearance</b>
        {showSubtitle && <em>{themeLabel(theme)}</em>}
      </span>
    </button>
  );
}
