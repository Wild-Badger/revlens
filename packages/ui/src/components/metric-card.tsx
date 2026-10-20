import { cn } from "../lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  className?: string;
}

/**
 * Metric card for dashboard KPIs.
 *
 * Design rationale:
 * - Single focal point (value) with supporting metadata (label, change)
 *   respects visual hierarchy and Miller's Law chunking.
 * - Change indicator uses color + text to avoid color-only communication
 *   (WCAG 1.4.1 Use of Color).
 * - Ample internal padding (p-6) keeps content breathable and scannable.
 */
export function MetricCard({
  label,
  value,
  change,
  changeType = "neutral",
  className,
}: MetricCardProps) {
  const changeStyles = {
    positive: "text-accent-emerald",
    negative: "text-accent-rose",
    neutral: "text-foreground-tertiary",
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface p-6 shadow-sm",
        className
      )}
    >
      <p className="text-sm font-medium text-foreground-secondary">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">
        {value}
      </p>
      {change && (
        <p className={cn("mt-1 text-sm font-medium", changeStyles[changeType])}>
          {changeType === "positive" && "↑ "}
          {changeType === "negative" && "↓ "}
          {changeType === "neutral" && "• "}
          {change}
        </p>
      )}
    </div>
  );
}
