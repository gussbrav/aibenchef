import { Card } from "@/components/ui";
import type { RatioEeff } from "@/lib/domains/analytics";
import { formatNumberCompact, formatPct } from "../_lib/format";
import { formatPeriod } from "./_lib/format-period";

export function HistoricTable({ rows }: { rows: RatioEeff[] }) {
  return (
    <Card variant="elevated" className="p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-6 py-3 font-semibold sticky left-0 bg-slate-50">
                Período
              </th>
              <th className="text-right px-4 py-3 font-semibold">Activo</th>
              <th className="text-right px-4 py-3 font-semibold">Cartera bruta</th>
              <th className="text-right px-4 py-3 font-semibold">Depósitos</th>
              <th className="text-right px-4 py-3 font-semibold">Patrimonio</th>
              <th className="text-right px-4 py-3 font-semibold">Util. neta</th>
              <th className="text-right px-4 py-3 font-semibold">Mora</th>
              <th className="text-right px-4 py-3 font-semibold">ROA</th>
              <th className="text-right px-4 py-3 font-semibold">ROE</th>
              <th className="text-right px-6 py-3 font-semibold">Eficiencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={`${r.periodo}-${r.moneda}`} className="hover:bg-slate-50">
                <td className="px-6 py-2.5 font-medium text-slate-900 sticky left-0 bg-white whitespace-nowrap">
                  {formatPeriod(r.periodo)}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">
                  {formatNumberCompact(r.totalActivo)}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">
                  {formatNumberCompact(r.carteraBruta)}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">
                  {formatNumberCompact(r.depositosSbs)}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">
                  {formatNumberCompact(r.patrimonio)}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">
                  {formatNumberCompact(r.utilidadNeta)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatPct(r.ratioMora)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatPct(r.roa)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatPct(r.roe)}
                </td>
                <td className="px-6 py-2.5 text-right text-slate-700 tabular-nums">
                  {formatPct(r.ratioEficiencia)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
