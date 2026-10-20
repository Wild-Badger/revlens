import { cn } from "../lib/utils";

interface ShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Dashboard shell — consistent page wrapper for all portfolio apps.
 *
 * Design rationale:
 * - Canvas background provides deepest layer; surface cards pop against it
 *   (Gestalt: figure/ground).
 * - Responsive padding follows content-driven breakpoints, not arbitrary
 *   device widths.
 * - max-w-7xl prevents line lengths that hurt readability
 *   (cognitive load / eye strain).
 */
export function Shell({ children, className, ...props }: ShellProps) {
  return (
    <main
      className={cn(
        "min-h-screen bg-canvas px-4 py-8 sm:px-6 lg:px-8",
        className
      )}
      {...props}
    >
      <div className="mx-auto max-w-7xl space-y-8">{children}</div>
    </main>
  );
}
