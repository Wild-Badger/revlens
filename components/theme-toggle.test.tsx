import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "./theme-toggle";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

it("defaults to dark, persists the choice and keeps both shell controls in sync", () => {
  render(<><ThemeToggle /><ThemeToggle /></>);
  const buttons = screen.getAllByRole("button", { name: "Light theme" });
  expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(buttons[0]);
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("revlens-theme")).toBe("light");
  expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(buttons[1]);
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("restores an explicit saved light preference", () => {
  localStorage.setItem("revlens-theme", "light");
  render(<ThemeToggle />);
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(screen.getByRole("button", { name: "Light theme" })).toHaveAttribute("aria-pressed", "true");
});

it("still toggles when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: "Light theme" }));
  expect(document.documentElement.dataset.theme).toBe("light");
});
