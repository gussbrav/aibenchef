/**
 * Sección 2 — Cobertura del último periodo.
 *
 * Tabla pivote: filas = topico, columnas = grupo.
 * Cada celda muestra % completado + cuántos archivos hay.
 */

import type { CoberturaRow } from "@/lib/domains/pipeline";
import { labelGrupo, ORDEN_GRUPOS_DB } from "@/lib/domains/shared/grupos";

// Orden uniforme en toda la UI: Bancos → Financieras → Cajas Municipales →
// Cajas Rurales → Empresas de Créditos.
const GRUPOS_ORDEN = [...ORDEN_GRUPOS_DB];

export function CoberturaSection({ rows }: { rows: CoberturaRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic">
        Sin archivos descargados para el último periodo.
      </p>
    );
  }

  // Pivot: { topico → { grupo → CoberturaRow } }
  const topicos = Array.from(new Set(rows.map((r) => r.topico))).sort();
  const gruposPresentes = new Set(rows.map((r) => r.grupo));
  const gruposEff: string[] = GRUPOS_ORDEN.filter((g) => gruposPresentes.has(g));
  // Fallback: grupos no listados en GRUPOS_ORDEN aparecen al final.
  for (const g of gruposPresentes) {
    if (!gruposEff.includes(g)) gruposEff.push(g);
  }

  const byKey: Record<string, CoberturaRow> = {};
  for (const r of rows) {
    byKey[`${r.topico}|${r.grupo}`] = r;
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr>
            <th className="text-left p-2 border-b font-semibold text-slate-700 w-32">
              Tópico
            </th>
            {gruposEff.map((g) => (
              <th
                key={g}
                className="text-center p-2 border-b font-semibold text-slate-700 min-w-[80px]"
              >
                {labelGrupo(g)}
              </th>
            ))}
            <th className="text-center p-2 border-b font-semibold text-slate-700">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {topicos.map((topico) => {
            const cells = gruposEff.map((g) => byKey[`${topico}|${g}`]);
            const total = cells.reduce(
              (acc, r) => acc + (r?.totalArchivos ?? 0),
              0,
            );
            const procesados = cells.reduce(
              (acc, r) => acc + (r?.procesados ?? 0),
              0,
            );
            const noPub = cells.reduce(
              (acc, r) => acc + (r?.noPublicados ?? 0),
              0,
            );
            const esperados = total - noPub;
            const pctTotal = esperados === 0 ? 100 : Math.round((procesados / esperados) * 100);
            return (
              <tr key={topico} className="border-b">
                <td className="p-2 font-mono text-slate-800">{topico}</td>
                {cells.map((r, idx) => (
                  <td key={idx} className="p-2 text-center">
                    {r ? <CoberturaCell row={r} /> : <span className="text-slate-300">—</span>}
                  </td>
                ))}
                <td className="p-2 text-center font-semibold">
                  {pctTotal}%
                  <div className="text-[10px] text-slate-500">
                    {procesados}/{esperados}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CoberturaCell({ row }: { row: CoberturaRow }) {
  const { pctCompletado, errores, pendientes, noPublicados } = row;
  const color =
    errores > 0
      ? "text-red-700"
      : pendientes > 0
        ? "text-amber-700"
        : pctCompletado === 100
          ? "text-emerald-700"
          : "text-slate-700";
  const icon =
    errores > 0 ? "❌" : pendientes > 0 ? "⏳" : pctCompletado === 100 ? "✅" : "⚪";
  return (
    <div className={color}>
      <div className="font-semibold">
        {icon} {pctCompletado}%
      </div>
      <div className="text-[10px] opacity-75">
        {row.procesados}/{row.totalArchivos - row.noPublicados}
        {noPublicados > 0 ? ` · ${noPublicados} n/p` : null}
      </div>
    </div>
  );
}
