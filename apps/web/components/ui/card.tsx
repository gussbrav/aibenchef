import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "outlined" | "elevated";
}

const variantMap = {
  default: "bg-white border border-slate-200",
  outlined: "bg-white border-2 border-brand-600",
  elevated: "bg-white shadow-xl shadow-slate-900/5 border border-slate-100",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-2xl p-6", variantMap[variant], className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";
