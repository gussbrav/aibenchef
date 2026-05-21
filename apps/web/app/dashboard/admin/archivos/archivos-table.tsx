import { Card } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { ArchivoDescargado } from "@/lib/domains/admin";
import { formatNumberCompact } from "../../_lib/format";

const statusBadge: Record<ArchivoDescargado["status"], string> = {
  descargado: "text-slate-700 bg-slate-100",
  procesando: "text-amber-700 bg-amber-100",
  procesado: "text-emerald-700 bg-emerald-100",
  error: "text-rose-700 bg-rose-100",
  omitido: "text-slate-500 bg-slate-50",
};

const MESES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

export function ArchivosTable({ archivos }: { archivos: ArchivoDescargado[] }) {
  if (archivos.length === 0) {
    return (
      <Card variant="elevated" className="p-10 text-center">
        <p className="text-slate-600">No hay archivos con esos filtros.</p>
      </Card>
    );
  }
  return (
    <Card variant="elevated" className="p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3 font-semibold">Período</th>
              <th className="text-left px-4 py-3 font-semibold">Grupo</th>
              <th className="text-left px-4 py-3 font-semibold">Tópico</th>
              <th className="text-left px-4 py-3 font-semibold">Archivo</th>
              <th className="text-right px-4 py-3 font-semibold">Tamaño</th>
              <th className="text-left px-4 py-3 font-semibold">Formato</th>
              <th className="text-left px-4 py-3 font-semibold">Status</th>
              <th className="text-right px-4 py-3 font-semibold">Filas</th>
              <th className="text-left px-4 py-3 font-semibold">Descargado</th>
              <th className="text-left px-4 py-3 font-semibold">SBS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {archivos.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 text-slate-900 whitespace-nowrap">
                  {MESES[a.mes - 1]} {a.anio}
                </td>
                <td className="px-4 py-2.5 text-slate-700">{a.grupo}</td>
                <td className="px-4 py-2.5 text-slate-700">{a.topico}</td>
                <td className="px-4 py-2.5 text-slate-700 font-mono text-xs">
                  {a.nombreArchivo}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums whitespace-nowrap">
                  {formatNumberCompact(a.tamanioBytes)} B
                </td>
                <td className="px-4 py-2.5 text-slate-500 text-xs uppercase">
                  {a.formato ?? "—"}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={cn(
                      "inline-flex text-xs px-2 py-0.5 rounded-md font-medium",
                      statusBadge[a.status],
                    )}
                  >
                    {a.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                  {a.filasInsertadas != null ? a.filasInsertadas.toLocaleString("es-PE") : "—"}
                </td>
                <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">
                  {a.descargadoEn.slice(0, 16)}
                </td>
                <td className="px-4 py-2.5">
                  <a
                    href={a.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 hover:underline text-xs"
                  >
                    Origen
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
