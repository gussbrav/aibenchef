import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  tone?: "default" | "muted" | "dark";
}

const toneMap = {
  default: "bg-white",
  muted: "bg-slate-50",
  dark: "bg-slate-900 text-white",
};

export const Section = forwardRef<HTMLElement, SectionProps>(
  ({ className, tone = "default", ...props }, ref) => (
    <section
      ref={ref}
      className={cn("py-20 lg:py-28", toneMap[tone], className)}
      {...props}
    />
  ),
);
Section.displayName = "Section";

export function SectionHeading({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto max-w-2xl text-center space-y-4", className)}>
      {eyebrow && (
        <p className="text-xs font-semibold tracking-widest text-brand-600 uppercase">
          {eyebrow}
        </p>
      )}
      <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-900">
        {title}
      </h2>
      {description && (
        <p className="text-lg text-slate-600 leading-relaxed">{description}</p>
      )}
    </div>
  );
}
