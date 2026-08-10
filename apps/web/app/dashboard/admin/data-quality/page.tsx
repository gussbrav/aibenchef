/**
 * /dashboard/admin/data-quality — Sistema de Data Quality (Pilares 1+4+5).
 *
 * Introducido tras el incidente C-4103-my2026 (jul-2026): archivo SBS truncado
 * dejo al peer group EDPYMEs sin Utilidad/ROE/ROA/PE en 202605 sin que nadie
 * lo detectara. Este dashboard hubiera flagged el problema en 3 lugares:
 *   1. Completeness — EDPYME EEFF may-26 con parcial 1/6 entidades.
 *   2. Ingest quality — archivo sospechoso por filas << promedio.
 *   3. Freshness — MVs derivadas no actualizadas post-import corrupto.
 *
 * Componentes:
 *   - Score global 0-100 con desglose por pilar.
 *   - Missing files (V136) — archivos esperados pero no llegaron.
 *   - Freshness (V137) — MVs stale vs SLA.
 *   - Sospechosos (V135) — cargas parciales detectadas.
 */

import type { Metadata } from "next";
import { AlertOctagon, Clock, FileSearch, Gauge, GitCompareArrows } from "lucide-react";
import Link from "next/link";

import {
  getDataQualityScore,
  listFreshness,
  listMissingFiles,
  listReconciliacion,
  listSospechosos,
} from "@/lib/domains/pipeline";
import type { DQSeverity } from "@/lib/domains/pipeline";
import { RecheckStalePanel } from "./recheck-stale-panel";

export const metadata: Metadata = {
  title: "Data Quality",
};

export const dynamic = "force-dynamic";

export default async function DataQualityPage() {
  const [score, missing, freshness, sospechosos, reconciliacion] = await Promise.all([
    getDataQualityScore(),
    listMissingFiles(50),
    listFreshness(),
    listSospechosos(30),
    listReconciliacion(),
  ]);

  return (
    <div className="space-y-8 px-4 lg:px-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Data Quality</h1>
        <p className="text-slate-600 text-sm">
          Salud del pipeline SBS → marts → dashboards. Detecta archivos faltantes, cargas
          truncadas y MVs stale antes de que impacten al usuario final.
        </p>
      </header>

      {/* RECHECK STALE — accion primaria si hay archivos SBS stuck.
          Va ARRIBA porque es lo mas accionable: 1 click resuelve el
          problema mas comun (archivos que SBS publico tarde o que se
          guardaron corruptos por el bug historico del downloader). */}
      <RecheckStalePanel />

      {/* SCORE */}
      <section className="space-y-3">
        <SectionHeader icon={Gauge} title="Data Quality Score" />
        <ScoreGrid score={score} />
      </section>

      {/* COMPLETENESS */}
      <section className="space-y-3">
        <SectionHeader
          icon={FileSearch}
          title={`Archivos faltantes — ${missing.length} en últimos 6 meses`}
        />
        <MissingTable rows={missing} />
      </section>

      {/* FRESHNESS */}
      <section className="space-y-3">
        <SectionHeader
          icon={Clock}
          title={`Freshness de MVs — ${freshness.filter((r) => r.severity !== "ok").length} fuera de SLA`}
        />
        <FreshnessTable rows={freshness} />
      </section>

      {/* SOSPECHOSOS */}
      <section className="space-y-3">
        <SectionHeader
          icon={AlertOctagon}
          title={`Cargas sospechosas — ${sospechosos.length} archivos con anomalía`}
        />
        <SospechososTable rows={sospechosos} />
      </section>

      {/* RECONCILIACIÓN RAW↔MARTS */}
      <section className="space-y-3">
        <SectionHeader
          icon={GitCompareArrows}
          title={`Reconciliación raw ↔ marts — ${reconciliacion.length} divergencias`}
        />
        <ReconciliacionTable rows={reconciliacion} />
      </section>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Componentes UI                                                           */
/* ──────────────────────────────────────────────────────────────────────── */

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

function scoreColor(score: number): string {
  if (score >= 90) return "text-emerald-700 bg-emerald-50 border-emerald-300";
  if (score >= 70) return "text-amber-800 bg-amber-50 border-amber-300";
  return "text-red-800 bg-red-50 border-red-300";
}

function ScoreGrid({ score }: { score: Awaited<ReturnType<typeof getDataQualityScore>> }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <div className={`rounded-lg border p-5 ${scoreColor(score.overall)}`}>
        <div className="text-[10px] uppercase tracking-wide font-semibold opacity-70">
          Score global
        </div>
        <div className="text-5xl font-bold mt-1">{score.overall}</div>
        <div className="text-xs mt-2 opacity-80">
          Promedio de los 4 pilares. 100 = todo verde.
        </div>
      </div>
      <ScoreCard title="Completeness" value={score.completeness}
        detalle={`${score.detalle.missingCriticos} críticos · ${score.detalle.missingWarnings} warnings`} />
      <ScoreCard title="Freshness" value={score.freshness}
        detalle={`${score.detalle.mvsStaleCriticas} MVs críticas · ${score.detalle.mvsStaleAnaliticas} analíticas`} />
      <ScoreCard title="Ingest quality" value={score.ingestQuality}
        detalle={`${score.detalle.sospechosos} archivos sospechosos`} />
      <ScoreCard title="Reconciliación" value={score.reconciliation}
        detalle={`${score.detalle.reconciliacionCritical} críticas · ${score.detalle.reconciliacionWarning} warnings`} />
    </div>
  );
}

function ScoreCard({ title, value, detalle }: { title: string; value: number; detalle: string }) {
  return (
    <div className={`rounded-lg border p-5 ${scoreColor(value)}`}>
      <div className="text-[10px] uppercase tracking-wide font-semibold opacity-70">{title}</div>
      <div className="text-4xl font-bold mt-1">{value}</div>
      <div className="text-xs mt-2 opacity-80">{detalle}</div>
    </div>
  );
}

const SEV_BADGE: Record<DQSeverity, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  warning: "bg-amber-100 text-amber-800 border-amber-300",
  info: "bg-sky-100 text-sky-800 border-sky-300",
  ok: "bg-emerald-100 text-emerald-800 border-emerald-300",
  never_refreshed: "bg-slate-100 text-slate-700 border-slate-300",
};

function SeverityBadge({ sev }: { sev: DQSeverity }) {
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${SEV_BADGE[sev]}`}>
      {sev}
    </span>
  );
}

function MissingTable({ rows }: { rows: Awaited<ReturnType<typeof listMissingFiles>> }) {
  if (rows.length === 0) {
    return <EmptyState mensaje="No hay archivos faltantes en los últimos 6 meses. 🎉" />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
          <tr>
            <Th>Periodo</Th>
            <Th>Grupo</Th>
            <Th>Tópico</Th>
            <Th className="text-right">Esperados</Th>
            <Th className="text-right">Encontrados</Th>
            <Th className="text-right">Faltantes</Th>
            <Th>Fecha esperada</Th>
            <Th>Severity</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, idx) => (
            <tr key={`${r.periodo}-${r.grupo}-${r.topico}-${idx}`}>
              <Td>{r.periodo}</Td>
              <Td>{r.grupo}</Td>
              <Td>{r.topico}</Td>
              <Td className="text-right">{r.nEsperados}</Td>
              <Td className="text-right">{r.nEncontrados}</Td>
              <Td className="text-right font-semibold">{r.nFaltantes}</Td>
              <Td>{r.fechaEsperada}</Td>
              <Td><SeverityBadge sev={r.severity} /></Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FreshnessTable({ rows }: { rows: Awaited<ReturnType<typeof listFreshness>> }) {
  const problemas = rows.filter((r) => r.severity !== "ok");
  const display = problemas.length > 0 ? problemas : rows.slice(0, 8);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
          <tr>
            <Th>MV</Th>
            <Th>Tier</Th>
            <Th className="text-right">SLA (h)</Th>
            <Th className="text-right">Edad (h)</Th>
            <Th>Último refresh OK</Th>
            <Th>Triggered by</Th>
            <Th>Severity</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {display.map((r) => (
            <tr key={r.mvName}>
              <Td className="font-mono text-xs">{r.mvName}</Td>
              <Td className="uppercase text-[10px] font-semibold text-slate-500">{r.tier}</Td>
              <Td className="text-right">{r.slaHours}</Td>
              <Td className="text-right">{r.ageHours == null ? "—" : r.ageHours.toFixed(1)}</Td>
              <Td className="text-xs text-slate-500">{r.lastSuccessfulRefresh ?? "—"}</Td>
              <Td className="text-xs text-slate-500">{r.triggeredBy ?? "—"}</Td>
              <Td><SeverityBadge sev={r.severity} /></Td>
            </tr>
          ))}
        </tbody>
      </table>
      {problemas.length === 0 ? (
        <p className="text-xs text-slate-500 px-3 py-2">
          Todo dentro de SLA — se muestran las 8 MVs más antiguas para contexto.
        </p>
      ) : null}
    </div>
  );
}

function SospechososTable({ rows }: { rows: Awaited<ReturnType<typeof listSospechosos>> }) {
  if (rows.length === 0) {
    return <EmptyState mensaje="No hay cargas sospechosas detectadas. 🎉" />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
          <tr>
            <Th>Periodo</Th>
            <Th>Grupo</Th>
            <Th>Tópico</Th>
            <Th>Archivo</Th>
            <Th className="text-right">Filas</Th>
            <Th>Status</Th>
            <Th>Motivo</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const chk = r.checkResult ?? {};
            const reason = (chk["reason"] as string | undefined) ?? "—";
            const ratio = chk["ratio"] as number | undefined;
            const prom = chk["rows_promedio"] as number | undefined;
            return (
              <tr key={r.id}>
                <Td>{r.periodo}</Td>
                <Td>{r.grupo}</Td>
                <Td>{r.topico}</Td>
                <Td className="font-mono text-xs">{r.nombreArchivo}</Td>
                <Td className="text-right">
                  {r.filasInsertadas ?? "—"}
                  {prom ? <span className="text-slate-400"> / {prom}</span> : null}
                </Td>
                <Td>
                  <SeverityBadge sev={r.status === "sospechoso" ? "warning" : "info"} />
                </Td>
                <Td className="text-xs">
                  {reason}
                  {ratio != null ? ` (ratio ${(ratio * 100).toFixed(0)}%)` : ""}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-slate-500 px-3 py-2">
        Para recuperar un archivo sospechoso: encolar sync job con{" "}
        <code className="rounded bg-slate-100 px-1 py-0.5">forceRedownload: true</code>{" "}
        vía <Link href="/dashboard/admin/archivos" className="text-sky-700 underline">/admin/archivos</Link>.
      </p>
    </div>
  );
}

function ReconciliacionTable({ rows }: { rows: Awaited<ReturnType<typeof listReconciliacion>> }) {
  if (rows.length === 0) {
    return <EmptyState mensaje="raw y marts están perfectamente sincronizados. 🎉" />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
          <tr>
            <Th>Periodo</Th>
            <Th>Tipo estado</Th>
            <Th>Moneda</Th>
            <Th className="text-right">N raw</Th>
            <Th className="text-right">N marts</Th>
            <Th className="text-right">Delta</Th>
            <Th>Severity</Th>
            <Th>Diagnóstico</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, idx) => (
            <tr key={`${r.periodo}-${r.tipoEstado}-${r.moneda}-${idx}`}>
              <Td>{r.periodo}</Td>
              <Td>{r.tipoEstado}</Td>
              <Td>{r.moneda}</Td>
              <Td className="text-right">{r.nRaw}</Td>
              <Td className="text-right">{r.nMarts}</Td>
              <Td className="text-right font-semibold">{r.delta}</Td>
              <Td><SeverityBadge sev={r.severity} /></Td>
              <Td className="text-xs">{r.detail}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ mensaje }: { mensaje: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
      {mensaje}
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-semibold ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
