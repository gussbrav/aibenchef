"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileBarChart2, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils/cn";

type ERFila = {
  codigo: string;
  nombre: string;
  nivel: number;
  esSubtotal: boolean;
  esCalculado: boolean;
  saldoActual: number | null;
  saldoPrev: number | null;
  varAbs: number | null;
  varPct: number | null;
  avActualPct: number | null;
  avPrevPct: number | null;
};

type ERData = {
  entidad: string;
  periodoActual: { codigo: number; label: string };
  periodoPrev: { codigo: number; label: string };
  moneda: "MN" | "ME" | "TOTAL";
  filas: ERFila[];
};

type EntidadOpt = { nombCorreg: string; tipoEntidad: string };
type PeriodoOpt = number;

const fmtMiles = (v: number | null): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 }).format(v);
};

const fmtPct = (v: number | null): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("es-PE", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(v);
};

const fmtVarAbs = (v: number | null, esNegativo: boolean): string => {
  if (v === null) return "—";
  const formatted = fmtMiles(Math.abs(v));
  return esNegativo ? `-${formatted}` : formatted;
};

export function AcumuladoClient() {
  const router = useRouter();
  const [entidades, setEntidades] = useState<EntidadOpt[]>([]);
  const [periodos, setPeriodos] = useState<PeriodoOpt[]>([]);
  const [entidad, setEntidad] = useState<string>("");
  const [periodo, setPeriodo] = useState<number | null>(null);
  const [moneda, setMoneda] = useState<"MN" | "ME" | "TOTAL">("TOTAL");
  const [data, setData] = useState<ERData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cargar entidades + periodos del endpoint metadata
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/v1/eeff/metadata");
        const j = await r.json();
        if (j.error) {
          setError(j.error.message ?? "Error cargando metadata");
          return;
        }
        const d = j.data as { entidades: EntidadOpt[]; periodos: number[] };
        setEntidades(d.entidades);
        setPeriodos(d.periodos);
        if (d.entidades.length > 0 && !entidad) {
          const bcp = d.entidades.find((e) =>
            e.nombCorreg.toLowerCase().includes("credito"),
          );
          setEntidad(bcp?.nombCorreg || d.entidades[0]!.nombCorreg);
        }
        if (d.periodos.length > 0 && !periodo) {
          setPeriodo(d.periodos[0]!);
        }
      } catch (e) {
        setError(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargar = useCallback(async () => {
    if (!entidad || !periodo) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        entidad,
        periodo: String(periodo),
        moneda,
      });
      const r = await fetch(`/api/v1/eeff/estado-resultados-acumulado?${params}`);
      const j = await r.json();
      if (j.error) {
        setError(j.error.message ?? "Error");
        setData(null);
      } else {
        setData(j.data as ERData);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [entidad, periodo, moneda]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="text-slate-500 hover:text-slate-900"
            aria-label="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <FileBarChart2 className="w-6 h-6 text-brand-600" />
              Estado de Resultados Anualizado (TTM)
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Tendencia year-to-date comparada con el mismo periodo del año anterior — entiendé en
              segundos cómo cierra el año cualquier entidad SBS. Cifras en miles de soles.
            </p>
          </div>
        </div>
      </div>

      {/* Selectores */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Entidad</label>
          <select
            value={entidad}
            onChange={(e) => setEntidad(e.target.value)}
            className="w-full h-9 px-3 text-sm rounded border border-slate-300 bg-white"
          >
            {entidades.map((e) => (
              <option key={e.nombCorreg} value={e.nombCorreg}>
                [{e.tipoEntidad}] {e.nombCorreg}
              </option>
            ))}
          </select>
        </div>
        <div className="w-32">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Periodo</label>
          <select
            value={periodo ?? ""}
            onChange={(e) => setPeriodo(Number(e.target.value))}
            className="w-full h-9 px-2 text-sm rounded border border-slate-300 bg-white"
          >
            {periodos.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="w-24">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Moneda</label>
          <select
            value={moneda}
            onChange={(e) => setMoneda(e.target.value as "MN" | "ME" | "TOTAL")}
            className="w-full h-9 px-2 text-sm rounded border border-slate-300 bg-white"
          >
            <option value="TOTAL">TOTAL</option>
            <option value="MN">MN</option>
            <option value="ME">ME</option>
          </select>
        </div>
        <button
          type="button"
          onClick={cargar}
          disabled={loading}
          className="h-9 px-4 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded inline-flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Consultar
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Subtitulo estilo PPT */}
          <div className="text-center">
            <h2 className="text-xl font-bold text-brand-700">
              Estado de Resultados Acumulado ({data.periodoActual.label.replace("-", " 20")})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">(en miles de soles) · {data.entidad}</p>
          </div>

          {/* Tabla principal */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-brand-700 text-white">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold uppercase tracking-wider text-[11px]">
                    Estado de Resultados
                  </th>
                  <th className="text-right px-3 py-2 font-semibold w-24">{data.periodoPrev.label}</th>
                  <th className="text-right px-3 py-2 font-semibold w-24">{data.periodoActual.label}</th>
                  <th className="text-right px-3 py-2 font-semibold w-24">Var. S/.</th>
                  <th className="text-right px-3 py-2 font-semibold w-20">Var. %</th>
                  <th className="text-right px-3 py-2 font-semibold w-20 text-[10px]">
                    A V<br />{data.periodoPrev.label}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold w-20 text-[10px]">
                    A V<br />{data.periodoActual.label}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.filas.map((f, i) => {
                  const isNeg = f.varAbs !== null && f.varAbs < 0;
                  const indent = (f.nivel - 1) * 16;
                  return (
                    <tr
                      key={`${f.codigo}-${i}`}
                      className={cn(
                        "border-b border-slate-100 hover:bg-slate-50",
                        f.esSubtotal && "bg-sky-50 font-semibold text-slate-900",
                        f.esCalculado && f.esSubtotal && "bg-emerald-50",
                      )}
                    >
                      <td
                        className={cn(
                          "px-3 py-1.5",
                          f.esSubtotal ? "uppercase text-[11px]" : "text-slate-700",
                        )}
                        style={{ paddingLeft: `${12 + indent}px` }}
                      >
                        {f.nombre}
                      </td>
                      <td className="text-right px-3 py-1.5 tabular-nums">
                        {fmtMiles(f.saldoPrev)}
                      </td>
                      <td className="text-right px-3 py-1.5 tabular-nums">
                        {fmtMiles(f.saldoActual)}
                      </td>
                      <td
                        className={cn(
                          "text-right px-3 py-1.5 tabular-nums",
                          isNeg ? "text-rose-600" : "text-slate-700",
                        )}
                      >
                        {fmtVarAbs(f.varAbs, isNeg)}
                      </td>
                      <td
                        className={cn(
                          "text-right px-3 py-1.5 tabular-nums",
                          isNeg ? "text-rose-600" : "text-emerald-700",
                        )}
                      >
                        {fmtPct(f.varPct)}
                      </td>
                      <td className="text-right px-3 py-1.5 tabular-nums text-slate-500">
                        {fmtPct(f.avPrevPct)}
                      </td>
                      <td className="text-right px-3 py-1.5 tabular-nums text-slate-500">
                        {fmtPct(f.avActualPct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Disclaimer */}
          <div className="text-[11px] text-slate-500 px-2">
            <strong>Notas:</strong> Las filas en mayúsculas son subtotales. Las filas con
            fondo verde (MARGEN FINANCIERO NETO DE INGR. Y GASTOS POR SERV., RESULTADO DE
            OPERACION) son calculadas a partir de otras cuentas SBS, no provienen
            directamente del reporte. AV = Análisis Vertical (porcentaje vs Ingresos
            Financieros). Var % calculada sobre el periodo anterior; si éste es cero, se
            muestra "—".
          </div>
        </>
      )}

      {!data && !loading && !error && (
        <div className="text-center py-12 text-sm text-slate-500">
          Selecciona entidad + periodo y presiona <strong>Consultar</strong>.
        </div>
      )}
    </div>
  );
}
