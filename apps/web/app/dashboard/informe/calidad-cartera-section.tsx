"use client";

/**
 * SeccionCalidadCartera — bubble chart 2x2 riesgo vs cobertura + tabla lateral.
 *
 * X: Cartera de Alto Riesgo Ajustada (menor = mejor calidad crediticia)
 * Y: Provisiones / Cartera atrasada (mayor = mejor colchon)
 *
 * Los datos son OFICIALES SBS del reporte prudencial mensual (los mismos
 * que estan en el archivo B-XXXX / C-XXXX que publica SBS). Aplicable a
 * bancos, financieras, cajas municipales, cajas rurales y edpymes —
 * SBS publica el mismo indicador para todos los grupos.
 *
 * Diseno: split view chart + tabla lateral (2026-08-27 rediseño).
 *   - Chart: cuadrantes coloreados + burbujas grandes con # de ranking
 *     dentro. Sin pills flotantes (colisionaban cuando dos entidades
 *     caian cerca del cruce de medianas — bug reportado con Caja
 *     Arequipa vs Financiera Confianza).
 *   - Tabla lateral: # ranking (color-coded), labelCorto completo,
 *     badge de cuadrante, CAR% y Cobertura%. Fila propia con highlight
 *     brand-50. En print/mobile la tabla baja debajo del chart.
 *   - Cross-ref: el # dentro de cada burbuja == # de fila en la tabla.
 *
 * Boton "Generar publicacion IA" reutiliza el pipeline de
 * /api/v1/publicaciones/generate con tema='calidad_cartera'. Gate por
 * PLAN_LIMITS.publicacionesPorMes (Free=0, Trial=3, Pro=20, Business=999).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  type TooltipProps,
} from "recharts";
import { Loader2, Sparkles } from "lucide-react";

import type { CalidadCarteraPoint, Competidor } from "@/lib/domains/informe/types";

type Cuadrante = "GANADOR" | "SOBRECUBIERTO" | "OPTIMISTA" | "FRAGIL";

type CalidadPayload = {
  x: number; // CAR ajustada
  y: number; // cobertura
  label: string;
  color: string;
  esPropia: boolean;
  rank: number; // 1..N por menor CAR
  cuadrante: Cuadrante;
};

const CUADRANTE_META: Record<Cuadrante, { label: string; color: string; halo: string }> = {
  GANADOR:       { label: "GANADOR",       color: "#059669", halo: "#d1fae5" }, // emerald
  SOBRECUBIERTO: { label: "SOBRE-CUBIERTO", color: "#0891b2", halo: "#cffafe" }, // cyan
  OPTIMISTA:     { label: "OPTIMISTA",     color: "#d97706", halo: "#fef3c7" }, // amber
  FRAGIL:        { label: "FRÁGIL",        color: "#dc2626", halo: "#fee2e2" }, // rose
};

export function SeccionCalidadCartera({
  data,
  competidores,
  clienteSlug,
  entidadPropia,
  periodo,
  periodoLabel,
  publicacionesAllowed,
}: {
  data: CalidadCarteraPoint[];
  competidores: Competidor[];
  clienteSlug: string;
  entidadPropia: string;
  periodo: number;
  periodoLabel: string;
  /** Del plan del user: publicacionesPorMes > 0. Free = false. */
  publicacionesAllowed: boolean;
}) {
  const router = useRouter();
  const [generando, setGenerando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (data.length === 0) {
    return (
      <section>
        <SectionHeader />
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
          Sin datos oficiales SBS de Cartera de Alto Riesgo Ajustada para este
          período y peer group. SBS suele publicar este indicador entre 2 y 4
          semanas después del cierre; el sistema lo captura automáticamente en
          la próxima ingesta.
        </div>
      </section>
    );
  }

  // Ranking por menor CAR ajustada (1 = mejor calidad)
  const rankedByCar = [...data].sort((a, b) => a.carAjustada - b.carAjustada);
  const rankMap = new Map<string, number>();
  rankedByCar.forEach((d, i) => rankMap.set(d.nombCorreg, i + 1));

  // Mediana del peer group para separar los 4 cuadrantes visualmente.
  // No es "la mediana del sistema" (que el user pidio no mostrar) — es
  // el centro NATURAL del propio peer group, indispensable para leer
  // los cuadrantes. Sin esta linea de cruce, el user tiene que
  // imaginar donde termina "seguro" y empieza "fragil".
  const sortedX = [...data].map((d) => d.carAjustada).sort((a, b) => a - b);
  const sortedY = [...data].map((d) => d.cobertura).sort((a, b) => a - b);
  const medX = sortedX[Math.floor(sortedX.length / 2)] ?? 0;
  const medY = sortedY[Math.floor(sortedY.length / 2)] ?? 0;

  const clasificarCuadrante = (car: number, cov: number): Cuadrante => {
    if (car <= medX && cov >= medY) return "GANADOR";
    if (car > medX && cov >= medY) return "SOBRECUBIERTO";
    if (car <= medX && cov < medY) return "OPTIMISTA";
    return "FRAGIL";
  };

  // Merge con competidores para colores + flag propia + ranking + cuadrante
  const scatterData: CalidadPayload[] = data.map((d) => {
    const comp = competidores.find((c) => c.nombCorreg === d.nombCorreg);
    return {
      x: d.carAjustada,
      y: d.cobertura,
      label: comp?.labelCorto ?? d.nombCorreg,
      color: comp?.color ?? "#94a3b8",
      esPropia: comp?.esPropio ?? false,
      rank: rankMap.get(d.nombCorreg) ?? 0,
      cuadrante: clasificarCuadrante(d.carAjustada, d.cobertura),
    };
  });

  const xVals = scatterData.map((d) => d.x);
  const yVals = scatterData.map((d) => d.y);
  const xMin = Math.max(0, Math.min(...xVals) - 1.5);
  const xMax = Math.max(...xVals) + 1.5;
  const yMin = Math.max(0, Math.min(...yVals) - 25);
  const yMax = Math.max(...yVals) + 25;

  async function generarPublicacion() {
    if (generando) return;
    setGenerando(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/v1/publicaciones/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tema: "calidad_cartera",
          periodo,
          clienteSlug,
          entidadPropia,
          peerGroup: competidores.map((c) => c.nombCorreg),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      const id = json?.data?.id ?? json?.id;
      if (id) router.push(`/dashboard/publicaciones/${id}` as never);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error de red");
    } finally {
      setGenerando(false);
    }
  }

  return (
    <section>
      <SectionHeader />
      <p className="text-sm text-slate-500 mb-4 mt-3">
        Peer group al {periodoLabel} sobre matriz 2×2 con cuadrantes
        coloreados. Las líneas grises punteadas marcan la <em>mediana del peer
        group</em> (no del sistema completo). Cada burbuja lleva un{" "}
        <strong className="text-slate-700">número de ranking</strong> que
        matchea la tabla lateral (1 = menor riesgo). Datos oficiales SBS.
      </p>

      {/* Leyenda de cuadrantes — clave visual para leer el chart */}
      <div className="flex flex-wrap gap-2 mb-3 text-[11px]">
        {(["GANADOR", "SOBRECUBIERTO", "OPTIMISTA", "FRAGIL"] as const).map((k) => {
          const m = CUADRANTE_META[k];
          const desc: Record<Cuadrante, string> = {
            GANADOR: "bajo riesgo + alta cobertura",
            SOBRECUBIERTO: "alto riesgo pero bien cubierto",
            OPTIMISTA: "bajo riesgo pero cobertura delgada",
            FRAGIL: "alto riesgo + baja cobertura",
          };
          return (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border"
              style={{ borderColor: m.color, backgroundColor: m.halo }}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
              <strong style={{ color: m.color }}>{m.label}</strong>
              <span className="text-slate-600">— {desc[k]}</span>
            </span>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px] print:grid-cols-1">
        <div>
        <div style={{ width: "100%", height: 440 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 20, right: 40, bottom: 55, left: 60 }}>
              {/* ============ ZONAS DE CUADRANTE (fondo sutil) ============
                  Recharts renderiza en orden — poner ANTES del grid + puntos
                  para que quede detras. Con eje X invertido:
                    Visualmente ARRIBA-DERECHA = ganador (bajo car + alta cov)
                    Visualmente ABAJO-IZQUIERDA = fragil (alto car + baja cov)
                  Pero ReferenceArea usa las coords REALES (no visuales) del
                  eje. Con reversed:true en XAxis, x1..x2 se renderiza flip.
              */}
              <ReferenceArea x1={xMin} x2={medX} y1={medY} y2={yMax} fill={CUADRANTE_META.GANADOR.halo} fillOpacity={0.35} />
              <ReferenceArea x1={medX} x2={xMax} y1={medY} y2={yMax} fill={CUADRANTE_META.SOBRECUBIERTO.halo} fillOpacity={0.35} />
              <ReferenceArea x1={xMin} x2={medX} y1={yMin} y2={medY} fill={CUADRANTE_META.OPTIMISTA.halo} fillOpacity={0.35} />
              <ReferenceArea x1={medX} x2={xMax} y1={yMin} y2={medY} fill={CUADRANTE_META.FRAGIL.halo} fillOpacity={0.35} />
              <ReferenceLine x={medX} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.6} />
              <ReferenceLine y={medY} stroke="#94a3b8" strokeDasharray="4 3" strokeOpacity={0.6} />
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.5} />
              <XAxis
                type="number"
                dataKey="x"
                domain={[xMin, xMax]}
                label={{
                  value: "◄ Menor riesgo    Cartera de Alto Riesgo Ajustada (%)    Mayor riesgo ►",
                  position: "insideBottom",
                  offset: -20,
                  style: { fontSize: 12, fill: "#475569", fontWeight: 500 },
                }}
                tickFormatter={(v) => `${v.toFixed(1)}%`}
                reversed
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={[yMin, yMax]}
                label={{
                  value: "▲ Mejor cobertura    Provisiones / Atrasada (%)    Peor ▼",
                  angle: -90,
                  position: "insideLeft",
                  offset: 0,
                  style: { textAnchor: "middle", fontSize: 12, fill: "#475569", fontWeight: 500 },
                }}
                tickFormatter={(v) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                content={(props: TooltipProps<number, string>) => {
                  const { active, payload } = props;
                  if (!active || !payload || payload.length === 0) return null;
                  const d = payload[0].payload as CalidadPayload | undefined;
                  if (!d) return null;
                  const meta = CUADRANTE_META[d.cuadrante];
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-xs min-w-[240px]">
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-100">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: d.color }}
                        />
                        <p className="font-semibold text-slate-900">{d.label}</p>
                        {d.esPropia && (
                          <span className="ml-auto text-[10px] uppercase tracking-wider text-brand-700 font-bold">
                            Propia
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-slate-600">
                        <span>Ranking calidad</span>
                        <span className="font-mono font-semibold text-slate-900">
                          #{d.rank} de {scatterData.length}
                        </span>
                        <span>CAR Ajustada</span>
                        <span className="font-mono font-semibold text-slate-900">
                          {d.x.toFixed(2)}%
                        </span>
                        <span>Cobertura</span>
                        <span className="font-mono font-semibold text-slate-900">
                          {d.y.toFixed(2)}%
                        </span>
                        <span className="pt-1 mt-1 border-t border-slate-100">Cuadrante</span>
                        <span
                          className="pt-1 mt-1 border-t border-slate-100 font-semibold"
                          style={{ color: meta.color }}
                        >
                          {meta.label}
                        </span>
                      </div>
                    </div>
                  );
                }}
              />
              <Scatter
                data={scatterData}
                isAnimationActive={false}
                shape={(props: {
                  cx?: number;
                  cy?: number;
                  payload?: CalidadPayload;
                }) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null || !payload) return <g />;
                  // Burbujas mas grandes ahora que no hay pill flotante que
                  // compita por el espacio vertical (radio +4 vs version previa).
                  const r = payload.esPropia ? 17 : 14;
                  const cuadColor = CUADRANTE_META[payload.cuadrante].color;
                  return (
                    <g>
                      {payload.esPropia && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r + 6}
                          fill="none"
                          stroke={payload.color}
                          strokeWidth={2}
                          strokeDasharray="3 2"
                          opacity={0.6}
                        />
                      )}
                      {/* Halo del color del cuadrante — comunica performance a un vistazo */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r + 4}
                        fill={cuadColor}
                        fillOpacity={0.2}
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill={payload.color}
                        fillOpacity={0.92}
                        stroke="#fff"
                        strokeWidth={2.5}
                        style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.25))" }}
                      />
                      {/* Numero de ranking dentro de la burbuja — cross-ref
                          con tabla lateral. Font tabular para alineacion. */}
                      <text
                        x={cx}
                        y={cy + 4}
                        textAnchor="middle"
                        className="font-bold"
                        fill="#fff"
                        style={{
                          pointerEvents: "none",
                          fontSize: 13,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {payload.rank}
                      </text>
                    </g>
                  );
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-slate-400 mt-2 text-center">
          Eje X invertido: valores a la derecha = menor riesgo. Fuente:
          Superintendencia de Banca, Seguros y AFP (SBS) — reporte prudencial{" "}
          {periodoLabel}.
        </p>
        </div>

        {/* ============ TABLA LATERAL DE RANKING ============
            Reemplaza los pills flotantes (que colisionaban) por una tabla
            leible con nombres completos, valores y badge de cuadrante.
            El # de cada fila matchea el # dentro de la burbuja del chart. */}
        <div className="md:border-l md:border-slate-100 md:pl-6 print:border-l-0 print:pl-0 print:border-t print:border-slate-200 print:pt-4 print:mt-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600 mb-3">
            Ranking por calidad
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <th className="text-left font-semibold py-1.5 pr-2 w-6">#</th>
                  <th className="text-left font-semibold py-1.5 pr-2">Entidad</th>
                  <th className="text-right font-semibold py-1.5 pl-1 pr-1">CAR</th>
                  <th className="text-right font-semibold py-1.5 pl-1">Cob.</th>
                </tr>
              </thead>
              <tbody>
                {[...scatterData]
                  .sort((a, b) => a.rank - b.rank)
                  .map((d) => {
                    const meta = CUADRANTE_META[d.cuadrante];
                    return (
                      <tr
                        key={d.label}
                        className={`border-b border-slate-50 ${d.esPropia ? "bg-brand-50/60" : ""}`}
                      >
                        <td className="py-2 pr-2 align-top">
                          <span
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white"
                            style={{
                              backgroundColor: d.color,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {d.rank}
                          </span>
                        </td>
                        <td className="py-2 pr-2 align-top">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`truncate ${d.esPropia ? "font-bold text-brand-800" : "font-semibold text-slate-800"}`}
                              title={d.label}
                            >
                              {d.label}
                            </span>
                            {d.esPropia && (
                              <span className="text-brand-700 text-[10px] font-bold">
                                ★
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span
                              className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: meta.color }}
                            />
                            <span
                              className="text-[10px] font-medium"
                              style={{ color: meta.color }}
                            >
                              {meta.label}
                            </span>
                          </div>
                        </td>
                        <td
                          className="py-2 pl-1 pr-1 text-right font-mono text-slate-800 align-top"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {d.x.toFixed(2)}%
                        </td>
                        <td
                          className="py-2 pl-1 text-right font-mono text-slate-800 align-top"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {d.y.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-400 mt-2 leading-snug">
            El número dentro de cada burbuja corresponde a su posición en esta
            tabla. Ordenado por menor CAR ajustada (mejor calidad crediticia).
          </p>
        </div>
        </div>
      </div>

      {/* Publicación IA — mismo estilo visual que "Analisis del experto" (report-insights.tsx) */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 print-avoid-break no-print">
        <header className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-700" />
            <h3 className="text-sm font-semibold text-slate-900">Publicación IA</h3>
          </div>
        </header>
          {publicacionesAllowed ? (
            <div className="text-center py-4">
              <p className="text-xs text-slate-500 mb-3">
                Genera un artículo tipo LinkedIn automático basado en los datos de esta sección.
              </p>
              <button
                type="button"
                onClick={generarPublicacion}
                disabled={generando}
                className="inline-flex items-center gap-1.5 h-8 px-3 bg-brand-700 hover:bg-brand-800 text-white text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generando ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Generando...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Generar publicación con IA
                  </>
                )}
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-4">
              💡 Inicia tu prueba de 14 días para desbloquear publicaciones IA
              que convierten este análisis en un artículo listo para LinkedIn.
            </p>
          )}
          {errorMsg && (
            <p className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5 text-center">
              {errorMsg}
            </p>
          )}
      </div>
    </section>
  );
}

function SectionHeader() {
  return (
    <h2 className="inline-flex items-center gap-2.5 text-sm font-bold uppercase tracking-[0.08em] text-slate-800 mb-1">
      <span className="w-1 h-5 rounded-full bg-brand-500" />
      Calidad de Cartera — Alto Riesgo Ajustado vs Cobertura
    </h2>
  );
}
