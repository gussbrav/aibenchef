"use client";

/**
 * RecheckStalePanel — panel admin para disparar el force-recheck de
 * archivos SBS marcados stale (no_publicado_sbs viejos), sin necesidad
 * de SSH ni acceso a consola del container aibenchef-data.
 *
 * Reemplaza el flujo manual:
 *   docker exec <container> aibenchef sbs recheck-stale-no-publicados
 *
 * Consume:
 *   GET  /api/v1/admin/recheck-stale  → preview de archivos stale
 *   POST /api/v1/admin/recheck-stale  → encola sync_jobs con force_redownload
 *
 * Muestra un summary por periodo (grupos faltantes + dias stale) y un
 * boton grande "Forzar re-descarga ahora". Post-click: refresca el
 * preview automaticamente (los sync_jobs quedan pending → running →
 * completed en 1-5 min).
 */

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ExternalLink,
  FileText, Loader2, RefreshCw, Zap,
} from "lucide-react";

type ArchivoStale = {
  filename: string;
  grupo: string;
  topico: string;
  actualizado_en: string;
  dias_stale: number;
};

type ResumenPeriodo = {
  periodo: number;
  gruposFaltantes: string[];
  topicosAfectados: string[];
  diasStaleMax: number;
  totalArchivos: number;
  archivos: ArchivoStale[];
};

type SyncJobActivo = {
  id: number;
  periodo: number;
  status: string;
  triggered_by: string;
  requested_at: string;
};

type StaleData = {
  total: number;
  resumen: ResumenPeriodo[];
  syncJobsActivos?: SyncJobActivo[];
};

type ActionResult = {
  ok: boolean;
  encolados: number;
  skipeados: number;
  jobIds?: number[];
  periodos?: number[];
  totalArchivosStale?: number;
  mensaje: string;
};

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function fmtPeriodo(p: number): string {
  const anio = Math.floor(p / 100);
  const mes = p % 100;
  return `${MESES[mes - 1] ?? "?"}-${String(anio).slice(2)}`;
}

export function RecheckStalePanel() {
  const [data, setData] = useState<StaleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Filas expandidas — mostrar archivos individuales (filenames SBS)
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpanded = (periodo: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(periodo)) next.delete(periodo);
      else next.add(periodo);
      return next;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/recheck-stale");
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      const payload = (json?.data ?? json) as StaleData;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trigger = async () => {
    if (!confirm(
      "¿Encolar re-descarga forzada para los períodos afectados?\n\n" +
      "El worker (aibenchef-data) los procesa en los próximos minutos. " +
      "Los archivos locales corruptos (HTML basura) se re-bajan y validan " +
      "con magic-byte check.",
    )) return;
    setTriggering(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/v1/admin/recheck-stale", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      const payload = (json?.data ?? json) as ActionResult;
      setResult(payload);
      // Refresh el preview — algunos jobs pueden bajar de la lista al ser encolados
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setTriggering(false);
    }
  };

  const total = data?.total ?? 0;
  const hasStale = total > 0;
  const isError = error !== null;
  // Estado visual del panel: error > stale > saludable.
  // Si hay error, el "saludable" seria enganoso (no pudimos verificar).
  const state: "error" | "stale" | "healthy" | "loading" = isError
    ? "error"
    : loading && !data
      ? "loading"
      : hasStale
        ? "stale"
        : "healthy";

  const borderClass =
    state === "error"
      ? "border-red-300 bg-red-50/60"
      : state === "stale"
        ? "border-red-300 bg-red-50/60"
        : state === "loading"
          ? "border-slate-200 bg-slate-50"
          : "border-emerald-200 bg-emerald-50/40";

  return (
    <div className={`rounded-lg border p-5 ${borderClass}`}>
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          {state === "healthy" ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
          ) : state === "loading" ? (
            <Loader2 className="w-6 h-6 text-slate-400 flex-shrink-0 mt-0.5 animate-spin" />
          ) : (
            <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">
              {state === "error"
                ? "No se pudo verificar el estado del pipeline"
                : state === "loading"
                  ? "Verificando archivos SBS..."
                  : hasStale
                    ? `${total} archivos SBS stale — bloqueando data`
                    : "Sin archivos stale — pipeline saludable"}
            </h3>
            <p className="text-xs text-slate-600 mt-0.5 max-w-3xl">
              {state === "error" ? (
                <>
                  No pudimos consultar <code className="text-[10px] bg-white px-1 rounded">admin.v_no_publicados_stale</code>.
                  Revisa el mensaje de error abajo y avisa a un admin si el problema persiste.
                </>
              ) : state === "loading" ? (
                "Consultando la vista de archivos stale..."
              ) : hasStale ? (
                <>
                  Estos archivos están marcados <code className="text-[10px] bg-white px-1 rounded">no_publicado_sbs</code>{" "}
                  hace más tiempo que <code className="text-[10px] bg-white px-1 rounded">fecha_esperada + lag×1.5</code>.
                  Típicamente: SBS los publicó tarde o el downloader guardó HTML basura como .xls (bug histórico
                  resuelto con V158 magic-byte check). Al forzar re-descarga se validan y procesan correctamente.
                </>
              ) : (
                "Todos los archivos SBS esperados están procesados o dentro del lag razonable de publicación."
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 h-8 px-2 text-[11px] font-medium text-slate-500 hover:text-slate-900 hover:bg-white rounded transition-colors flex-shrink-0"
          title="Refrescar"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refrescar
        </button>
      </header>

      {error && (
        <div className="bg-white border border-red-200 rounded p-3 text-xs text-red-800 mb-3 space-y-1">
          <p className="font-semibold">{error}</p>
          {error.toLowerCase().includes("permiso") && (
            <p className="text-red-700/80">
              Tu sesión no tiene los permisos requeridos. Pide a un admin
              que actualice tu rol en <code className="text-[10px] bg-white px-1 rounded">users.role = &apos;admin&apos;</code>{" "}
              o inicia sesión con una cuenta de admin.
            </p>
          )}
        </div>
      )}

      {hasStale && data && (
        <>
          <div className="bg-white border border-slate-200 rounded-md overflow-hidden mb-3">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold w-8"></th>
                  <th className="text-left px-3 py-2 font-semibold">Período</th>
                  <th className="text-left px-3 py-2 font-semibold">Grupos faltantes</th>
                  <th className="text-left px-3 py-2 font-semibold">Tópicos afectados</th>
                  <th className="text-right px-3 py-2 font-semibold">Archivos</th>
                  <th className="text-right px-3 py-2 font-semibold">Días stale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.resumen.map((r) => {
                  const isOpen = expanded.has(r.periodo);
                  return (
                    <React.Fragment key={r.periodo}>
                      <tr className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(r.periodo)}
                            className="w-5 h-5 flex items-center justify-center rounded hover:bg-slate-200"
                            title={isOpen ? "Ocultar archivos" : "Ver nombres de archivos"}
                            aria-label={isOpen ? "Ocultar archivos" : "Ver nombres de archivos"}
                          >
                            {isOpen ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-2 font-mono font-semibold text-slate-900">
                          {fmtPeriodo(r.periodo)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {r.gruposFaltantes.map((g) => (
                              <span
                                key={g}
                                className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-[10px] font-medium border border-red-200"
                              >
                                {g}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          {r.topicosAfectados.join(", ")}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700">
                          {r.totalArchivos}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-red-700">
                          {r.diasStaleMax}
                        </td>
                      </tr>
                      {isOpen && r.archivos.map((a, idx) => (
                        <tr
                          key={`${r.periodo}__${idx}`}
                          className="bg-slate-50/60 border-t border-dashed border-slate-200"
                        >
                          <td className="px-3 py-1.5"></td>
                          <td colSpan={5} className="px-3 py-1.5">
                            <div className="flex items-center gap-2 text-[11px] text-slate-600">
                              <FileText className="w-3 h-3 text-slate-400" />
                              <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-800">
                                {a.filename}
                              </code>
                              <span className="text-slate-400">·</span>
                              <span className="text-slate-500">
                                Último intento: {new Date(a.actualizado_en).toLocaleString("es-PE", {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Seccion "Jobs en progreso" — si hay sync_jobs pending/running,
              se muestran aca para que el user sepa que se estan procesando. */}
          {data.syncJobsActivos && data.syncJobsActivos.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-md p-3 mb-3">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                  Jobs en progreso ({data.syncJobsActivos.length})
                </h4>
                <Link
                  href="/dashboard/admin/pipeline"
                  className="text-[10px] text-blue-700 hover:text-blue-900 hover:underline inline-flex items-center gap-1"
                >
                  Ver progreso detallado en /admin/pipeline
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
              <table className="w-full text-[11px]">
                <thead className="text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="text-left py-1 font-medium">Job ID</th>
                    <th className="text-left py-1 font-medium">Período</th>
                    <th className="text-left py-1 font-medium">Status</th>
                    <th className="text-left py-1 font-medium">Origen</th>
                    <th className="text-right py-1 font-medium">Encolado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.syncJobsActivos.map((j) => (
                    <tr key={j.id}>
                      <td className="py-1 font-mono text-slate-700">#{j.id}</td>
                      <td className="py-1 font-mono font-semibold text-slate-900">
                        {fmtPeriodo(j.periodo)}
                      </td>
                      <td className="py-1">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-medium border ${
                          j.status === "running"
                            ? "bg-blue-100 text-blue-800 border-blue-200"
                            : "bg-amber-100 text-amber-800 border-amber-200"
                        }`}>
                          {j.status}
                        </span>
                      </td>
                      <td className="py-1 text-slate-600 font-mono">{j.triggered_by}</td>
                      <td className="py-1 text-right text-slate-500 font-mono">
                        {j.requested_at.slice(11, 16)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-slate-500 mt-2">
                El worker <code className="bg-slate-100 px-1 rounded">aibenchef-data</code> toma los jobs
                pending y los procesa (scrape → import). Refrescá este panel en 2-3 minutos
                para ver si bajaron los archivos.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-slate-500">
              Al forzar la re-descarga: se encola 1 <code className="text-[10px] bg-white px-1 rounded">admin.sync_jobs</code>{" "}
              por período con <code className="text-[10px] bg-white px-1 rounded">force_redownload=true</code>.
              El worker <code className="text-[10px] bg-white px-1 rounded">aibenchef-data</code> los procesa en 1-5 min.
            </p>
            <button
              type="button"
              onClick={trigger}
              disabled={triggering}
              className="inline-flex items-center gap-1.5 h-10 px-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded shadow-sm"
            >
              {triggering ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Encolando sync jobs...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Forzar re-descarga ahora
                </>
              )}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className={`mt-3 rounded border p-3 text-xs ${
          result.encolados > 0
            ? "bg-emerald-50 border-emerald-200 text-emerald-900"
            : "bg-amber-50 border-amber-200 text-amber-900"
        }`}>
          <div className="flex items-start gap-2">
            {result.encolados > 0 ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{result.mensaje}</p>
              {result.jobIds && result.jobIds.length > 0 && (
                <p className="mt-1 opacity-80">
                  Job IDs: <span className="font-mono">{result.jobIds.join(", ")}</span>.
                  {" "}Ver progreso en{" "}
                  <a
                    href="/dashboard/admin/pipeline"
                    className="underline hover:no-underline"
                  >
                    /dashboard/admin/pipeline
                  </a>
                  .
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
