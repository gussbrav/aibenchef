"use client";

import { useState, useEffect, useCallback } from "react";

type SyncJob = {
  id: number;
  periodoDesde: number;
  periodoHasta: number;
  topicos: string[] | null;
  grupos: string[] | null;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  archivosDescargados: number | null;
  archivosCambiados: number | null;
  filasImportadas: number | null;
  logText: string | null;
  errorMensaje: string | null;
  triggeredBy: string;
  triggeredByEmail: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  duracionSeg: number | null;
};

const TOPICOS_DISPONIBLES = [
  "eeff",
  "oficinas",
  "personal",
  "clientes_credito",
  "colocaciones",
  "depositos",
  "castigos",
  "creditos_depositos_geo",
];

export function SyncSbsPanel() {
  const [periodoDesde, setPeriodoDesde] = useState<number>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.getFullYear() * 100 + (d.getMonth() + 1);
  });
  const [periodoHasta, setPeriodoHasta] = useState<number>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.getFullYear() * 100 + (d.getMonth() + 1);
  });
  const [topicos, setTopicos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/admin/sync-sbs?limit=10");
      const j = await r.json();
      setJobs(j?.data?.jobs ?? j?.jobs ?? []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    if (!expanded) return;
    loadJobs();
    const hayActivo = jobs.some((j) => j.status === "pending" || j.status === "running");
    const interval = setInterval(loadJobs, hayActivo ? 5_000 : 30_000);
    return () => clearInterval(interval);
  }, [expanded, jobs, loadJobs]);

  const onSubmit = async () => {
    setSubmitting(true);
    setErrMsg(null);
    try {
      const r = await fetch("/api/v1/admin/sync-sbs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodoDesde,
          periodoHasta,
          topicos: topicos.length > 0 ? topicos : null,
          grupos: null, // siempre todos los grupos
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t);
      }
      await loadJobs();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 bg-brand-50 hover:bg-brand-100 transition"
      >
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-slate-900">
            ↻ Sincronizar con SBS
          </span>
          <span className="text-xs text-slate-600">
            Descargar / actualizar archivos para un período
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
      </button>

      {expanded && (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Periodo Desde (YYYYMM)
              </label>
              <input
                type="number"
                value={periodoDesde}
                onChange={(e) => setPeriodoDesde(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Periodo Hasta (YYYYMM)
              </label>
              <input
                type="number"
                value={periodoHasta}
                onChange={(e) => setPeriodoHasta(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm tabular-nums"
              />
            </div>
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white text-sm font-medium px-4 py-2 rounded-md"
            >
              {submitting ? "Encolando..." : "Encolar Sincronización"}
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Tópicos (vacío = todos)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {TOPICOS_DISPONIBLES.map((t) => (
                <button
                  key={t}
                  onClick={() =>
                    setTopicos((prev) =>
                      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                    )
                  }
                  className={`text-xs px-2 py-1 rounded-md border ${
                    topicos.includes(t)
                      ? "bg-brand-100 border-brand-400 text-brand-800 font-medium"
                      : "bg-white border-slate-300 text-slate-600"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {errMsg && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              {errMsg}
            </div>
          )}

          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold text-slate-700 mb-2">
              Jobs recientes ({jobs.length})
            </h4>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {jobs.length === 0 && <p className="text-xs text-slate-500">Sin jobs aún.</p>}
              {jobs.map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-3">
              💡 El worker corre vía cron mensual. Para ejecutarlo manualmente desde el servidor:
              <code className="ml-1 px-1 py-0.5 bg-slate-100 rounded text-[10px]">aibenchef sbs work-jobs</code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function JobRow({ job }: { job: SyncJob }) {
  const statusColors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    running: "bg-sky-100 text-sky-800",
    completed: "bg-emerald-100 text-emerald-800",
    failed: "bg-rose-100 text-rose-800",
    cancelled: "bg-slate-100 text-slate-600",
  };
  return (
    <div className="flex items-center justify-between gap-3 text-xs border-b border-slate-100 pb-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="font-mono text-slate-400">#{job.id}</span>
        <span className={`px-2 py-0.5 rounded font-medium ${statusColors[job.status] ?? "bg-slate-100"}`}>
          {job.status}
        </span>
        <span className="text-slate-700">
          {job.periodoDesde === job.periodoHasta
            ? job.periodoDesde
            : `${job.periodoDesde} → ${job.periodoHasta}`}
        </span>
        {job.topicos && (
          <span className="text-slate-500 truncate">[{job.topicos.join(", ")}]</span>
        )}
      </div>
      <div className="text-slate-400 tabular-nums text-right shrink-0">
        {job.duracionSeg != null && <span>{job.duracionSeg}s · </span>}
        {job.requestedAt}
      </div>
    </div>
  );
}
