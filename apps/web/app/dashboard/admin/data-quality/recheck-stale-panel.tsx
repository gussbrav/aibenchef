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

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Zap } from "lucide-react";

type ResumenPeriodo = {
  periodo: number;
  gruposFaltantes: string[];
  topicosAfectados: string[];
  diasStaleMax: number;
  totalArchivos: number;
};

type StaleData = {
  total: number;
  resumen: ResumenPeriodo[];
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

  return (
    <div
      className={`rounded-lg border p-5 ${
        hasStale
          ? "border-red-300 bg-red-50/60"
          : "border-emerald-200 bg-emerald-50/40"
      }`}
    >
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          {hasStale ? (
            <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">
              {hasStale
                ? `${total} archivos SBS stale — bloqueando data`
                : "Sin archivos stale — pipeline saludable"}
            </h3>
            <p className="text-xs text-slate-600 mt-0.5 max-w-3xl">
              {hasStale ? (
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

      {loading && !data && (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          Cargando estado de archivos stale...
        </div>
      )}

      {error && (
        <div className="bg-white border border-red-200 rounded p-3 text-xs text-red-800 mb-3">
          {error}
        </div>
      )}

      {hasStale && data && (
        <>
          <div className="bg-white border border-slate-200 rounded-md overflow-hidden mb-3">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Período</th>
                  <th className="text-left px-3 py-2 font-semibold">Grupos faltantes</th>
                  <th className="text-left px-3 py-2 font-semibold">Tópicos afectados</th>
                  <th className="text-right px-3 py-2 font-semibold">Archivos</th>
                  <th className="text-right px-3 py-2 font-semibold">Días stale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.resumen.map((r) => (
                  <tr key={r.periodo} className="hover:bg-slate-50">
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
                ))}
              </tbody>
            </table>
          </div>

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
