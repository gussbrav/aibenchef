import type { Metadata } from "next";
import { Construction } from "lucide-react";
import { Card } from "@/components/ui";

export const metadata: Metadata = {
  title: "Estados Financieros",
};

export const dynamic = "force-dynamic";

export default function EeffDashboardPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Estados Financieros</h1>
        <p className="text-slate-600">
          Detalle por entidad: balance general, estado de resultados y ratios canónicos.
        </p>
      </div>

      <Card variant="elevated" className="p-10 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center">
          <Construction className="w-7 h-7 text-amber-600" />
        </div>
        <h2 className="text-xl font-semibold text-slate-900">En construcción</h2>
        <p className="text-slate-600 max-w-md mx-auto text-sm leading-relaxed">
          Próxima iteración: selector de entidad, filtros por período y moneda, KPI cards
          con tendencia, tabla histórica completa y exportación a Excel/PDF.
        </p>
        <p className="text-xs text-slate-400">
          Mientras tanto, el resumen del sistema está en{" "}
          <a href="/dashboard" className="text-brand-600 hover:underline">/dashboard</a>.
        </p>
      </Card>
    </div>
  );
}
