/**
 * /dashboard/admin/pipeline — Pipeline Observability V1 (issue #18).
 *
 * Vista admin que muestra de un solo vistazo el estado del pipeline:
 * scrape → parse → ingesta → MVs → dashboard.
 *
 * 5 secciones:
 *  1. Salud General — semáforo por stage + lag de data
 *  2. Cobertura — % archivos procesados por (topico, grupo) último periodo
 *  3. Anomalías estructurales — drift de SBS vs cabecera_maestra
 *  4. Entidades delta — nuevas / desaparecidas vs periodo previo
 *  5. Timeline — últimas 20 corridas
 */

import type { Metadata } from "next";
import { Activity, AlertTriangle, Calendar, ListChecks, Sparkles } from "lucide-react";

import {
  getCobertura,
  getPipelineHealth,
  getTimeline,
  getUltimoPeriodoConArchivos,
  listAnomalias,
  listEntidadesDelta,
} from "@/lib/domains/pipeline";

import { AnomaliasTable } from "./anomalias-table";
import { CoberturaSection } from "./cobertura-section";
import { EntidadesDeltaSection } from "./entidades-delta-section";
import { SaludGeneralSection } from "./salud-general-section";
import { TimelineSection } from "./timeline-section";

export const metadata: Metadata = {
  title: "Pipeline Observability",
};

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const periodo = await getUltimoPeriodoConArchivos();

  const [health, cobertura, anomalias, entidadesDelta, timeline] = await Promise.all([
    getPipelineHealth(),
    periodo ? getCobertura(periodo) : Promise.resolve([]),
    listAnomalias({ periodo: periodo ?? undefined, unreviewed: true, limit: 50 }),
    listEntidadesDelta(),
    getTimeline(20),
  ]);

  return (
    <div className="space-y-8 px-4 lg:px-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Pipeline Observability
        </h1>
        <p className="text-slate-600 text-sm">
          Visibilidad end-to-end del flujo SBS → dashboard. Detecta drift estructural,
          entidades nuevas/desaparecidas, archivos no procesados.
        </p>
      </header>

      {/* SECCIÓN 1 — SALUD GENERAL */}
      <section className="space-y-3">
        <SectionHeader icon={Activity} title="Salud general" />
        <SaludGeneralSection health={health} />
      </section>

      {/* SECCIÓN 2 — COBERTURA */}
      <section className="space-y-3">
        <SectionHeader
          icon={ListChecks}
          title={`Cobertura — último periodo: ${periodo ?? "(sin data)"}`}
        />
        <CoberturaSection rows={cobertura} />
      </section>

      {/* SECCIÓN 3 — ANOMALÍAS ESTRUCTURALES */}
      <section className="space-y-3">
        <SectionHeader
          icon={AlertTriangle}
          title={`Anomalías estructurales — ${anomalias.length} sin revisar`}
        />
        <AnomaliasTable anomalias={anomalias} />
      </section>

      {/* SECCIÓN 4 — ENTIDADES DELTA */}
      <section className="space-y-3">
        <SectionHeader
          icon={Sparkles}
          title="Entidades nuevas / desaparecidas"
        />
        <EntidadesDeltaSection entidades={entidadesDelta} />
      </section>

      {/* SECCIÓN 5 — TIMELINE */}
      <section className="space-y-3">
        <SectionHeader icon={Calendar} title="Timeline — últimas 20 corridas" />
        <TimelineSection entries={timeline} />
      </section>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
      <Icon className="w-5 h-5 text-slate-600" />
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
    </div>
  );
}
