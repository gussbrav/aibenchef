/**
 * Sección 1 de /dashboard/admin/pipeline — Salud General.
 *
 * Muestra:
 * - 4 tarjetas con la última corrida por stage (scrape/import/refresh-mvs/detectar-cambios)
 * - 1 tarjeta con el lag de la data (semáforo green/amber/red)
 */

import type { PipelineHealth, StageName } from "@/lib/domains/pipeline";

const STAGE_LABELS: Record<StageName, string> = {
  scrape: "Scrape SBS",
  import: "Import",
  "refresh-mvs": "Refresh MVs",
  "detectar-cambios": "Detector",
  backfill: "Backfill",
};

const SEMAFORO_BG: Record<PipelineHealth["dataFreshness"]["semaforo"], string> = {
  green: "bg-emerald-50 border-emerald-300 text-emerald-900",
  amber: "bg-amber-50 border-amber-300 text-amber-900",
  red: "bg-red-50 border-red-300 text-red-900",
};

const SEMAFORO_LABEL: Record<PipelineHealth["dataFreshness"]["semaforo"], string> = {
  green: "🟢 al día",
  amber: "🟡 atrasado 2m",
  red: "🔴 atrasado",
};

export function SaludGeneralSection({ health }: { health: PipelineHealth }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {health.byStage.map((s) => (
        <StageCard
          key={s.stage}
          label={STAGE_LABELS[s.stage]}
          status={s.status}
          lastRun={s.lastRun}
          durationSeconds={s.durationSeconds}
        />
      ))}

      <div
        className={`rounded-lg border p-3 ${SEMAFORO_BG[health.dataFreshness.semaforo]}`}
      >
        <div className="text-[10px] uppercase tracking-wide font-semibold opacity-70">
          Última data
        </div>
        <div className="text-lg font-bold mt-1">
          {health.dataFreshness.ultimoPeriodoIngestado ?? "—"}
        </div>
        <div className="text-xs mt-1">
          {SEMAFORO_LABEL[health.dataFreshness.semaforo]}
          {health.dataFreshness.lagMeses != null
            ? ` (${health.dataFreshness.lagMeses}m)`
            : null}
        </div>
      </div>
    </div>
  );
}

function StageCard({
  label,
  status,
  lastRun,
  durationSeconds,
}: {
  label: string;
  status: string | null;
  lastRun: string | null;
  durationSeconds: number | null;
}) {
  const bg =
    status === "success"
      ? "bg-emerald-50 border-emerald-300 text-emerald-900"
      : status === "failed"
        ? "bg-red-50 border-red-300 text-red-900"
        : status === "running"
          ? "bg-sky-50 border-sky-300 text-sky-900"
          : "bg-slate-50 border-slate-300 text-slate-600";

  const icon = status === "success" ? "🟢" : status === "failed" ? "🔴" : status === "running" ? "🔄" : "⚪";

  return (
    <div className={`rounded-lg border p-3 ${bg}`}>
      <div className="text-[10px] uppercase tracking-wide font-semibold opacity-70">
        {label}
      </div>
      <div className="text-base font-bold mt-1 flex items-center gap-1">
        <span>{icon}</span>
        <span>{status ?? "sin data"}</span>
      </div>
      <div className="text-[11px] mt-1 opacity-75">
        {lastRun ? formatDateTime(lastRun) : "Nunca corrido"}
        {durationSeconds != null ? ` · ${durationSeconds.toFixed(1)}s` : null}
      </div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
