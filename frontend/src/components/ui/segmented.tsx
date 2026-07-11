import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string = string> {
  value: T;
  label: ReactNode;
  icon?: React.ElementType;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "sm",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm border border-border bg-background/40 p-0.5",
        className
      )}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "app-no-drag inline-flex items-center gap-1.5 rounded-[2px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? "bg-primary/25 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon && <Icon className="size-3.5 shrink-0" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
