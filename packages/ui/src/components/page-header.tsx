import { cn } from "../lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Page header with title and optional description.
 *
 * Design rationale:
 * - Inverted Pyramid: most important info (title) is largest and first.
 * - Description uses secondary foreground so it recedes visually.
 * - Action slot (children) aligns to the right on larger viewports
 *   to keep primary scan path clean (F-pattern).
 */
export function PageHeader({
  title,
  description,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="text-base text-foreground-secondary">{description}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
