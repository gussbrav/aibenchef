import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { formatPct } from "../_lib/format";

interface KpiTrendCardProps {
  label: string;
  hint: string;
  current: number | null;
  previous: number | null;
  kind: "ratio";
  goodIfHigher: boolean;
}

export function KpiTrendCard({
  label,
  hint,
  current,
  previous,
  goodIfHigher,
}: KpiTrendCardProps) {
  const delta = current != null && previous != null ? current - previous : null;
  const arrow = delta == null ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const isGood =
    delta == null
      ? null
      : goodIfHigher
        ? delta > 0
        : delta < 0;

  const deltaColor =
    isGood == null
      ? "text-slate-400"
      : isGood
        ? "text-emerald-600"
        : "text-rose-600";

  return (
    <Card variant="elevated" className="p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{label}</p>
        {delta != null && (
          <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", deltaColor)}>
            {arrow === "up" && <ArrowUp className="w-3 h-3" />}
            {arrow === "down" && <ArrowDown className="w-3 h-3" />}
            {arrow === "flat" && <Minus className="w-3 h-3" />}
            {formatDelta(delta)}
          </span>
        )}
      </div>
      <p className="text-3xl font-bold text-slate-900 mt-3 tabular-nums">
        {formatPct(current)}
      </p>
      <p className="text-xs text-slate-500 mt-1">{hint}</p>
      {previous != null && (
        <p className="text-xs text-slate-400 mt-3">
          Hace 12 meses: {formatPct(previous)}
        </p>
      )}
    </Card>
  );
}

function formatDelta(delta: number): string {
  const pct = delta * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)} pp`;
}
