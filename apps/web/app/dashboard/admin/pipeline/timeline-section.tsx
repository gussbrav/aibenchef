/**
 * Sección 5 — Timeline de las últimas 20 corridas del pipeline.
 *
 * Lee de raw.carga_log. Cada fila muestra stage, periodo, status, duración,
 * y rows insertadas. Click en el row con error para ver mensaje.
 */

import type { TimelineEntry } from "@/lib/domains/pipeline";

const STATUS_BG: Record<string, string> = {
  success: "text-emerald-700",
  failed: "text-red-700",
  running: "text-sky-700",
};

const STATUS_ICON: Record<string, string> = {
  success: "✓",
  failed: "✗",
  running: "↻",
};

export function TimelineSection({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic">
        Sin corridas registradas aún. Tras la primera ejecución de scrape /
        import / refresh-mvs aparecerán aquí.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr className="bg-slate-50 border-b">
            <th className="text-left p-2 font-semibold text-slate-700">Inicio</th>
            <th className="text-left p-2 font-semibold text-slate-700">Stage</th>
            <th className="text-left p-2 font-semibold text-slate-700">Tópico</th>
            <th className="text-right p-2 font-semibold text-slate-700">Periodo</th>
            <th className="text-center p-2 font-semibold text-slate-700">Estado</th>
            <th className="text-right p-2 font-semibold text-slate-700">Duración</th>
            <th className="text-right p-2 font-semibold text-slate-700">Rows</th>
            <th className="text-left p-2 font-semibold text-slate-700">Origen</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b hover:bg-slate-50">
              <td className="p-2 font-mono text-slate-600">
                {formatDateTime(e.startedAt)}
              </td>
              <td className="p-2 font-mono text-slate-800">{e.stage ?? "—"}</td>
              <td className="p-2 text-slate-700">{e.topico ?? "—"}</td>
              <td className="p-2 text-right font-mono">{e.periodo ?? "—"}</td>
              <td className={`p-2 text-center font-semibold ${STATUS_BG[e.status] ?? ""}`}>
                {STATUS_ICON[e.status] ?? "?"} {e.status}
              </td>
              <td className="p-2 text-right font-mono">
                {e.durationSeconds != null
                  ? e.durationSeconds < 60
                    ? `${e.durationSeconds.toFixed(1)}s`
                    : `${Math.floor(e.durationSeconds / 60)}m${(e.durationSeconds % 60).toFixed(0)}s`
                  : "—"}
              </td>
              <td className="p-2 text-right font-mono">
                {e.rowsInserted > 0 ? e.rowsInserted.toLocaleString() : "—"}
              </td>
              <td className="p-2 text-slate-500 text-[11px]">
                {e.triggeredBy ?? "—"}
                {e.errorMessage && (
                  <div className="text-red-600 mt-1 max-w-md truncate" title={e.errorMessage}>
                    {e.errorMessage}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
