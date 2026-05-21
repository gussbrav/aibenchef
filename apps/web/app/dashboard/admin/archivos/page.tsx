import type { Metadata } from "next";
import { Database, FileSpreadsheet, HardDrive } from "lucide-react";
import { Card } from "@/components/ui";
import { getArchivosStats, listArchivos } from "@/lib/domains/admin";
import { formatNumber, formatNumberCompact } from "../../_lib/format";
import { ArchivosFilters } from "./archivos-filters";
import { ArchivosTable } from "./archivos-table";

export const metadata: Metadata = {
  title: "Archivos SBS",
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    grupo?: string;
    topico?: string;
    status?: string;
    anio?: string;
  }>;
}

export default async function AdminArchivosPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = {
    grupo: params.grupo || undefined,
    topico: params.topico || undefined,
    status: params.status || undefined,
    anio: params.anio ? Number(params.anio) : undefined,
  };

  const [stats, archivos] = await Promise.all([
    getArchivosStats(),
    listArchivos({ ...filter, limit: 200 }),
  ]);

  const totalMb = stats.totalBytes / 1024 / 1024;
  const procesadosPct =
    stats.total > 0
      ? ((stats.porStatus.procesado ?? 0) / stats.total) * 100
      : 0;

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Archivos SBS descargados
        </h1>
        <p className="text-slate-600 text-sm">
          Inventario de los archivos .xls bajados desde intranet2.sbs.gob.pe y su estado de procesamiento.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={FileSpreadsheet}
          label="Archivos totales"
          value={formatNumber(stats.total)}
          sub={
            stats.periodoMin != null
              ? `Periodo: ${stats.periodoMin} → ${stats.periodoMax}`
              : "Sin datos"
          }
        />
        <KpiCard
          icon={HardDrive}
          label="Tamaño total"
          value={`${totalMb.toFixed(1)} MB`}
          sub={`${formatNumberCompact(stats.totalBytes)} bytes`}
        />
        <KpiCard
          icon={Database}
          label="Procesados"
          value={`${procesadosPct.toFixed(0)}%`}
          sub={`${stats.porStatus.procesado ?? 0} de ${stats.total} archivos`}
        />
        <KpiCard
          icon={Database}
          label="Grupos / Tópicos"
          value={`${Object.keys(stats.porGrupo).length} / ${Object.keys(stats.porTopico).length}`}
          sub="Cobertura del catálogo SBS"
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StatsBreakdown title="Por status" data={stats.porStatus} colorMap={statusColors} />
        <StatsBreakdown title="Por grupo" data={stats.porGrupo} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Listado</h2>
        <ArchivosFilters
          gruposDisponibles={Object.keys(stats.porGrupo)}
          topicosDisponibles={Object.keys(stats.porTopico)}
          statusesDisponibles={Object.keys(stats.porStatus)}
          filterActual={filter}
        />
        <ArchivosTable archivos={archivos} />
        <p className="text-xs text-slate-500">
          Mostrando {archivos.length} archivos
          {archivos.length === 200 ? " (límite, refinar filtros para ver más)" : ""}.
        </p>
      </section>
    </div>
  );
}

const statusColors: Record<string, string> = {
  descargado: "text-slate-700 bg-slate-100",
  procesando: "text-amber-700 bg-amber-100",
  procesado: "text-emerald-700 bg-emerald-100",
  error: "text-rose-700 bg-rose-100",
  omitido: "text-slate-500 bg-slate-50",
};

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card variant="elevated" className="p-5">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{label}</p>
        <Icon className="w-4 h-4 text-slate-400" />
      </div>
      <p className="text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </Card>
  );
}

function StatsBreakdown({
  title,
  data,
  colorMap,
}: {
  title: string;
  data: Record<string, number>;
  colorMap?: Record<string, string>;
}) {
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(data).sort(([, a], [, b]) => b - a);

  return (
    <Card variant="elevated" className="p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
      <div className="space-y-2">
        {sorted.map(([key, n]) => {
          const pct = (n / total) * 100;
          const colorClass = colorMap?.[key] ?? "text-slate-700 bg-slate-100";
          return (
            <div key={key} className="flex items-center gap-3">
              <span
                className={`inline-flex min-w-[7rem] justify-center text-xs px-2 py-0.5 rounded-md font-medium ${colorClass}`}
              >
                {key}
              </span>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-sm text-slate-700 tabular-nums w-16 text-right">{n}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
