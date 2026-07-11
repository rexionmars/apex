import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  eyebrow = "Empty",
  children,
  action,
  className,
}: {
  eyebrow?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-sm border border-dashed border-border px-6 py-8 text-center",
        className
      )}
    >
      <div className="eyebrow">{eyebrow}</div>
      <p className="max-w-sm text-sm text-muted-foreground">{children}</p>
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
