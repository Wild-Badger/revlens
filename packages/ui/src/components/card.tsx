import { cn } from "../lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType;
}

/**
 * Generic card container.
 * Use for any surface that groups related content.
 *
 * Design rationale:
 * - surface background creates clear figure/ground separation (Gestalt: Common Region)
 * - border-subtle provides containment without visual heaviness
 * - radius-lg keeps corners professional, not playful
 */
export function Card({
  className,
  as: Component = "div",
  children,
  ...props
}: CardProps) {
  return (
    <Component
      className={cn(
        "rounded-lg border border-border bg-surface shadow-sm",
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
