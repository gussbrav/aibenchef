/**
 * /dashboard/admin/reconciliacion-sbs — QA de calidad de nuestros ratios.
 *
 * Compara nuestros calculos (ROA, ROE, Mora criterio SBS) contra los
 * valores oficiales que SBS publica en el Excel prudencial mensual.
 * El usuario final SIEMPRE ve nuestro calculo; esta pagina es
 * back-office puro para detectar drift/bugs de metodologia.
 *
 * Semaforo por indicador con accuracy % de los ultimos 12 periodos.
 * Tabla de divergencias del ultimo periodo. Tabla de pendientes SBS.
 *
 * Populador: `pnpm reconcile-ratios` o llamada a gov.reconcile_ratios().
 */

import type { Metadata } from "next";
import { AlertOctagon, CheckCircle2, Clock, GitCompareArrows, Info } from "lucide-react";
import Link from "next/link";

import { Container, Card } from "@/components/ui";
import {
  getAccuracySummary,
  getPendingSbs,
  getRecentDivergences,
  INDICADOR_FORMULAS,
  INDICADOR_LABELS,
  type Indicador,
  type Severidad,
} from "@/lib/domains/ratio-reconciliation";

export const metadata: Metadata = {
  title: "Reconciliación SBS",
};

export const dynamic = "force-dynamic";

export default async function ReconciliacionSbsPage() {
  // Defensivo: si una de las 3 vistas gov.* no existe todavia (V177 aun
  // no aplico o esta a mitad), no tumbamos toda la pagina. Cada bloque
  // muestra su empty state y logueamos el error real al server console.
  const [summaryResult, divergencesResult, pendingResult] = await Promise.allSettled([
    getAccuracySummary(),
    getRecentDivergences(50),
    getPendingSbs(50),
  ]);
  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : [];
  const divergences = divergencesResult.status === "fulfilled" ? divergencesResult.value : [];
  const pending = pendingResult.status === "fulfilled" ? pendingResult.value : [];
  const errores: string[] = [];
  if (summaryResult.status === "rejected") {
    errores.push(`accuracy summary: ${String(summaryResult.reason?.message ?? summaryResult.reason)}`);
    console.error("[reconciliacion-sbs] getAccuracySummary failed:", summaryResult.reason);
  }
  if (divergencesResult.status === "rejected") {
    errores.push(`divergencias: ${String(divergencesResult.reason?.message ?? divergencesResult.reason)}`);
    console.error("[reconciliacion-sbs] getRecentDivergences failed:", divergencesResult.reason);
  }
  if (pendingResult.status === "rejected") {
    errores.push(`pendientes: ${String(pendingResult.reason?.message ?? pendingResult.reason)}`);
    console.error("[reconciliacion-sbs] getPendingSbs failed:", pendingResult.reason);
  }

  return (
    <Container size="xl" className="space-y-8 px-4 lg:px-6 py-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="w-6 h-6 text-slate-700" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Reconciliación SBS
          </h1>
        </div>
        <p className="text-slate-600 text-sm max-w-3xl leading-relaxed">
          Comparamos nuestros ratios calculados (ROA, ROE, Mora) contra los
          valores oficiales publicados por SBS en el Excel prudencial mensual.
          Al usuario final <strong>siempre</strong> le mostramos nuestro cálculo — esta página
          existe para detectar drift o bugs de metodología si SBS empieza a diferir.
        </p>
        <p className="text-xs text-slate-500">
          Refrescar reconciliación desde CLI:{" "}
          <code className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[11px] text-slate-700">
            pnpm --filter web reconcile-ratios
          </code>
        </p>
        {errores.length > 0 && (
          <div className="mt-3 rounded-md bg-rose-50 border border-rose-200 p-3 text-xs text-rose-900 space-y-1">
            <p className="font-semibold">
              {errores.length} query(s) fallaron al cargar esta página:
            </p>
            <ul className="list-disc pl-5 font-mono text-[11px] leading-relaxed">
              {errores.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <p className="text-[11px] text-rose-800 mt-2">
              Causa más probable: la migration V177 no aplicó completa. Revisá
              logs del container web al startup buscando <code>[migrator] applying V177</code>.
            </p>
          </div>
        )}
      </header>

      {/* ============ Semáforo ============ */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Accuracy de los últimos 12 períodos
        </h2>
        {summary.length === 0 ? (
          <EmptyState message="Aún no hay reconciliaciones. Corré `pnpm reconcile-ratios` para poblar." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(Object.keys(INDICADOR_LABELS) as Indicador[]).map((ind) => {
              const row = summary.find((s) => s.indicador === ind);
              return <AccuracyCard key={ind} indicador={ind} row={row} />;
            })}
          </div>
        )}
      </section>

      {/* ============ Divergencias ============ */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            Divergencias del último período reconciliado
          </h2>
          <span className="text-xs text-slate-500">
            Threshold: |Δ| &gt; 5 bps
          </span>
        </div>
        {divergences.length === 0 ? (
          <EmptyState
            message="Sin divergencias. Todos los ratios calculados están dentro de ±5 bps del valor oficial SBS."
            positive
          />
        ) : (
          <Card variant="elevated" className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Severidad</th>
                  <th className="text-left px-4 py-2 font-semibold">Entidad</th>
                  <th className="text-left px-4 py-2 font-semibold">Indicador</th>
                  <th className="text-right px-4 py-2 font-semibold">Nuestro</th>
                  <th className="text-right px-4 py-2 font-semibold">SBS</th>
                  <th className="text-right px-4 py-2 font-semibold">Δ (bps)</th>
                  <th className="text-left px-4 py-2 font-semibold">Notas</th>
                </tr>
              </thead>
              <tbody>
                {divergences.map((d) => (
                  <tr key={`${d.periodo}:${d.nombCorreg}:${d.indicador}`}
                      className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-2">
                      <SeverityPill severidad={d.severidad} />
                    </td>
                    <td className="px-4 py-2 text-slate-800">{d.nombCorreg}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {INDICADOR_LABELS[d.indicador]}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-800">
                      {d.derivedValue.toFixed(2)}%
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-800">
                      {d.sbsValue.toFixed(2)}%
                    </td>
                    <td className={`px-4 py-2 text-right font-mono font-semibold ${
                      d.deltaBps > 0 ? "text-rose-700" : "text-sky-700"
                    }`}>
                      {d.deltaBps > 0 ? "+" : ""}{d.deltaBps}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500 max-w-xs truncate">
                      {d.notas ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {/* ============ Pendientes SBS ============ */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-900">
            Pendientes de publicación SBS
          </h2>
        </div>
        <p className="text-xs text-slate-500">
          Ratios que ya calculamos y estamos mostrando al usuario, pero SBS
          aún no publicó el valor oficial (típicamente sale entre el día 20 y
          25 del mes siguiente). No requiere acción — se reconcilia solo cuando
          llegue el Excel prudencial.
        </p>
        {pending.length === 0 ? (
          <EmptyState message="Sin pendientes: todos los ratios del último período ya tienen contraparte SBS." />
        ) : (
          <Card variant="elevated" className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Período</th>
                  <th className="text-left px-4 py-2 font-semibold">Entidad</th>
                  <th className="text-left px-4 py-2 font-semibold">Indicador</th>
                  <th className="text-right px-4 py-2 font-semibold">Nuestro</th>
                  <th className="text-right px-4 py-2 font-semibold">Días esperando</th>
                </tr>
              </thead>
              <tbody>
                {pending.slice(0, 30).map((p) => (
                  <tr key={`${p.periodo}:${p.nombCorreg}:${p.indicador}`}
                      className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-slate-700">{p.periodo}</td>
                    <td className="px-4 py-2 text-slate-800">{p.nombCorreg}</td>
                    <td className="px-4 py-2 text-slate-700">
                      {INDICADOR_LABELS[p.indicador]}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-800">
                      {p.derivedValue.toFixed(2)}%
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">
                      {p.daysPending}d
                    </td>
                  </tr>
                ))}
                {pending.length > 30 && (
                  <tr className="border-t border-slate-100">
                    <td colSpan={5} className="px-4 py-2 text-xs text-slate-500 text-center">
                      … y {pending.length - 30} pendientes más
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {/* ============ Info fórmulas ============ */}
      <section>
        <details className="text-sm text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-800 mb-2">
            Fórmulas comparadas
          </summary>
          <div className="mt-3 space-y-3 pl-4 border-l-2 border-slate-200">
            {(Object.keys(INDICADOR_LABELS) as Indicador[]).map((ind) => (
              <div key={ind} className="space-y-1">
                <p className="font-semibold text-slate-800">
                  {INDICADOR_LABELS[ind]}
                </p>
                <p className="text-xs">
                  <span className="text-slate-500">Nuestro:</span>{" "}
                  <code className="font-mono">{INDICADOR_FORMULAS[ind].nuestro}</code>
                </p>
                <p className="text-xs">
                  <span className="text-slate-500">SBS oficial:</span>{" "}
                  <code className="font-mono">{INDICADOR_FORMULAS[ind].sbs}</code>
                </p>
              </div>
            ))}
          </div>
        </details>
      </section>

      <div className="pt-4 border-t border-slate-200">
        <Link
          href={"/dashboard/admin/data-quality" as never}
          className="text-sm text-brand-600 hover:underline"
        >
          ← Volver a Data Quality
        </Link>
      </div>
    </Container>
  );
}

// ============================================================================
// Sub-componentes
// ============================================================================

function AccuracyCard({
  indicador,
  row,
}: {
  indicador: Indicador;
  row: Awaited<ReturnType<typeof getAccuracySummary>>[number] | undefined;
}) {
  const label = INDICADOR_LABELS[indicador];
  if (!row || row.accuracyPct === null || row.reconciled === 0) {
    return (
      <Card variant="elevated" className="p-5 space-y-2 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-700">{label}</h3>
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Info className="w-4 h-4" />
          Sin reconciliaciones aún
        </div>
      </Card>
    );
  }
  const accuracy = row.accuracyPct;
  const color =
    accuracy >= 95 ? "emerald" : accuracy >= 85 ? "amber" : "rose";
  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    rose: "bg-rose-50 text-rose-800 ring-rose-200",
  };
  return (
    <Card variant="elevated" className={`p-5 space-y-3 ring-1 ${colorMap[color]}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        {accuracy >= 95 ? (
          <CheckCircle2 className="w-5 h-5" />
        ) : (
          <AlertOctagon className="w-5 h-5" />
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold">{accuracy.toFixed(1)}%</span>
        <span className="text-xs opacity-70">dentro de ±5 bps</span>
      </div>
      <div className="text-xs opacity-70 space-y-0.5">
        <p>
          {row.withinTol} / {row.reconciled} reconciliaciones alineadas
        </p>
        {row.avgAbsDeltaBps !== null && (
          <p>
            |Δ| promedio: {row.avgAbsDeltaBps.toFixed(1)} bps · máx:{" "}
            {row.maxAbsDeltaBps ?? 0} bps
          </p>
        )}
      </div>
    </Card>
  );
}

function SeverityPill({ severidad }: { severidad: Severidad }) {
  const map: Record<Severidad, { label: string; cls: string }> = {
    ok: { label: "ok", cls: "bg-emerald-100 text-emerald-800" },
    leve: { label: "leve", cls: "bg-amber-100 text-amber-800" },
    alto: { label: "alto", cls: "bg-orange-100 text-orange-800" },
    critico: { label: "crítico", cls: "bg-rose-100 text-rose-800" },
  };
  const s = map[severidad];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-bold ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

function EmptyState({ message, positive = false }: { message: string; positive?: boolean }) {
  const Icon = positive ? CheckCircle2 : Info;
  const color = positive ? "text-emerald-600" : "text-slate-400";
  return (
    <Card variant="elevated" className="p-6 flex items-center gap-3">
      <Icon className={`w-5 h-5 ${color}`} />
      <p className="text-sm text-slate-600">{message}</p>
    </Card>
  );
}
