"use client";

/**
 * SeccionCalidadCartera — bubble chart 2x2 riesgo vs cobertura.
 *
 * X: Cartera de Alto Riesgo Ajustada (menor = mejor calidad crediticia)
 * Y: Provisiones / Cartera atrasada (mayor = mejor colchon)
 *
 * Los datos son OFICIALES SBS del reporte prudencial mensual (los mismos
 * que estan en el archivo B-XXXX / C-XXXX que publica SBS). Aplicable a
 * bancos, financieras, cajas municipales, cajas rurales y edpymes —
 * SBS publica el mismo indicador para todos los grupos.
 *
 * Sin lineas de referencia (mediana del sistema) por decision de producto:
 * el bubble mismo comunica el ranking relativo dentro del peer group.
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
  Tooltip,
  type TooltipProps,
} from "recharts";
import { Loader2, Sparkles } from "lucide-react";

import type { CalidadCarteraPoint, Competidor } from "@/lib/domains/informe/types";

type CalidadPayload = {
  x: number; // CAR ajustada
  y: number; // cobertura
  label: string;
  color: string;
  esPropia: boolean;
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

  // Merge con competidores para colores + flag propia
  const scatterData: CalidadPayload[] = data.map((d) => {
    const comp = competidores.find((c) => c.nombCorreg === d.nombCorreg);
    return {
      x: d.carAjustada,
      y: d.cobertura,
      label: comp?.labelCorto ?? d.nombCorreg,
      color: comp?.color ?? "#94a3b8",
      esPropia: comp?.esPropio ?? false,
    };
  });

  const xVals = scatterData.map((d) => d.x);
  const yVals = scatterData.map((d) => d.y);
  const xMin = Math.max(0, Math.min(...xVals) - 1);
  const xMax = Math.max(...xVals) + 1;
  const yMin = Math.max(0, Math.min(...yVals) - 20);
  const yMax = Math.max(...yVals) + 20;

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
        Cada burbuja es una entidad del peer group al {periodoLabel}. Cuadrante
        ganador: <strong className="text-emerald-700">abajo-derecha</strong> (bajo
        riesgo + alta cobertura). Cuadrante frágil:{" "}
        <strong className="text-rose-700">arriba-izquierda</strong> (alto riesgo +
        baja cobertura). Datos oficiales SBS.
      </p>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6">
        <div style={{ width: "100%", height: 400 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 30, right: 40, bottom: 55, left: 70 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[xMin, xMax]}
                label={{
                  value: "Cartera de Alto Riesgo Ajustada (%)",
                  position: "insideBottom",
                  offset: -20,
                  style: { fontSize: 12, fill: "#475569" },
                }}
                tickFormatter={(v) => `${v.toFixed(1)}%`}
                reversed
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={[yMin, yMax]}
                label={{
                  value: "Cobertura Provisiones / Atrasada (%)",
                  angle: -90,
                  position: "insideLeft",
                  offset: 0,
                  style: { textAnchor: "middle", fontSize: 12, fill: "#475569" },
                }}
                tickFormatter={(v) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                content={(props: TooltipProps<number, string>) => {
                  const { active, payload } = props;
                  if (!active || !payload || payload.length === 0) return null;
                  const d = payload[0].payload as CalidadPayload | undefined;
                  if (!d) return null;
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-xs min-w-[220px]">
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
                        <span>CAR Ajustada</span>
                        <span className="font-mono font-semibold text-slate-900">
                          {d.x.toFixed(2)}%
                        </span>
                        <span>Cobertura</span>
                        <span className="font-mono font-semibold text-slate-900">
                          {d.y.toFixed(2)}%
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
                  const r = payload.esPropia ? 12 : 8;
                  const labelText = payload.label;
                  const pillW = labelText.length * 5.5 + 12;
                  const pillH = 16;
                  const labelY = cy - r - 10;
                  return (
                    <g>
                      {payload.esPropia && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={r + 4}
                          fill="none"
                          stroke={payload.color}
                          strokeWidth={2}
                          strokeDasharray="3 2"
                          opacity={0.6}
                        />
                      )}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill={payload.color}
                        fillOpacity={0.85}
                        stroke="#fff"
                        strokeWidth={2}
                        style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.18))" }}
                      />
                      <rect
                        x={cx - pillW / 2}
                        y={labelY - pillH + 4}
                        width={pillW}
                        height={pillH}
                        rx={pillH / 2}
                        ry={pillH / 2}
                        fill="#ffffff"
                        fillOpacity={0.92}
                        stroke={payload.color}
                        strokeWidth={1}
                        strokeOpacity={0.35}
                      />
                      <text
                        x={cx}
                        y={labelY}
                        textAnchor="middle"
                        className="text-[10px] font-semibold"
                        fill="#0f172a"
                      >
                        {labelText}
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
