import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export function Badge({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold tracking-wider uppercase rounded-full bg-brand-50 text-brand-700",
        className,
      )}
      {...props}
    />
  );
}
