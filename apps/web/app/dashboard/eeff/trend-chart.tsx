"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type { RatioEeff } from "@/lib/domains/analytics";
import { formatPeriodShort } from "./_lib/format-period";

interface TrendChartProps {
  data: RatioEeff[];
}

export function TrendChart({ data }: TrendChartProps) {
  const chartData = data.map((r) => ({
    periodo: r.periodo,
    label: formatPeriodShort(r.periodo),
    ROA: r.roa != null ? Number((r.roa * 100).toFixed(3)) : null,
    ROE: r.roe != null ? Number((r.roe * 100).toFixed(3)) : null,
    Mora: r.ratioMora != null ? Number((r.ratioMora * 100).toFixed(3)) : null,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickMargin={8}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            width={48}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "white",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "#0f172a", fontWeight: 600 }}
            formatter={(value: number | string) =>
              typeof value === "number" && Number.isFinite(value)
                ? `${value.toFixed(2)}%`
                : "—"
            }
          />
          <Legend
            iconType="line"
            wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
          />
          <Line
            type="monotone"
            dataKey="ROA"
            stroke="#2563eb"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="ROE"
            stroke="#10b981"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="Mora"
            stroke="#f43f5e"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
