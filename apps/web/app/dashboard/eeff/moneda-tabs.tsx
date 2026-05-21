"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import type { Moneda } from "@/lib/domains/analytics";

const MONEDAS: { value: Moneda; label: string; hint: string }[] = [
  { value: "TOTAL", label: "Total", hint: "MN + ME consolidado" },
  { value: "MN", label: "Soles", hint: "Moneda nacional" },
  { value: "ME", label: "Dólares", hint: "Moneda extranjera (en USD)" },
];

export function MonedaTabs({ valor }: { valor: Moneda }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function select(m: Moneda) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("moneda", m);
    router.push(`/dashboard/eeff?${params.toString()}` as never);
  }

  return (
    <div className="inline-flex h-11 items-center rounded-lg border border-slate-200 bg-slate-50 p-1">
      {MONEDAS.map((m) => {
        const selected = m.value === valor;
        return (
          <button
            key={m.value}
            type="button"
            onClick={() => select(m.value)}
            title={m.hint}
            className={cn(
              "h-full px-4 text-sm font-medium rounded-md transition-colors",
              selected
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900",
            )}
            aria-pressed={selected}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
