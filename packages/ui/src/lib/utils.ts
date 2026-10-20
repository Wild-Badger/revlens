import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes without style conflicts.
 * Uses clsx for conditional logic and tailwind-merge for deduplication.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as USD currency with compact notation for large values.
 * Used consistently across all portfolio dashboards.
 */
export function formatCurrency(
  value: number,
  opts: { compact?: boolean; maximumFractionDigits?: number } = {}
): string {
  const { compact = false, maximumFractionDigits = 0 } = opts;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
    notation: compact ? "compact" : "standard",
  }).format(value);
}

/**
 * Format a number with compact notation (e.g. 1.2K, 3M).
 */
export function formatNumber(
  value: number,
  opts: { maximumFractionDigits?: number } = {}
): string {
  const { maximumFractionDigits = 1 } = opts;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    notation: "compact",
  }).format(value);
}

/**
 * Format a percentage value.
 */
export function formatPercent(
  value: number,
  opts: { sign?: boolean; maximumFractionDigits?: number } = {}
): string {
  const { sign = false, maximumFractionDigits = 1 } = opts;
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    signDisplay: sign ? "exceptZero" : "auto",
    maximumFractionDigits,
  }).format(value);
}
