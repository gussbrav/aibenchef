import { FileBarChart2, Download, HelpCircle } from "lucide-react";
import { LoadingHint } from "./loading-hint";

/**
 * Skeleton PREMIUM del /dashboard/informe. Nivel Linear / Vercel / Notion.
 *
 * Filosofia:
 * - Contenido estatico que conocemos SIN fetch (titulo, iconos, kicker,
 *   secciones del cuadro resumen) se renderiza DE VERDAD desde el frame 1.
 *   Solo la data variable es shimmer.
 * - Shimmer real (gradient sweep) en lugar de pulse plano. Los rectangulos
 *   grises que barren luz se perciben como carga activa, no como bug.
 * - Hint contextual rotante ('Resolviendo peer group SBS...') transforma
 *   la espera en storytelling — el usuario ve QUE esta pasando.
 * - Branding visible desde el primer frame: gradient brand corporativo,
 *   icono real de Benchmark, tipografia final.
 *
 * Se muestra automaticamente como fallback del Suspense implicito de
 * Next.js mientras page.tsx corre las 4 queries en paralelo (~10s).
 */
export default function InformeLoading() {
  return (
    <div className="max-w-[1400px] mx-auto space-y-5 px-2">
      {/* ============ HERO — contenido real + shimmer solo en data ============ */}
      <header className="rounded-xl text-white p-8 relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 shadow-lg">
        {/* Textura decorativa sutil (radial glow) para dar profundidad premium */}
        <div
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.08) 0%, transparent 40%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.06) 0%, transparent 40%)",
          }}
        />
        <div className="flex items-start justify-between gap-6 flex-wrap relative z-10">
          <div className="flex-1 min-w-0">
            {/* Kicker REAL — es texto estatico, no shimmer */}
            <p className="text-xs uppercase tracking-[0.2em] opacity-70 mb-3 flex items-center gap-2">
              <FileBarChart2 className="w-3.5 h-3.5" strokeWidth={2.5} />
              Informe Ejecutivo de Benchmark
            </p>
            {/* Nombre del cliente — SHIMMER (viene de getInformeData) */}
            <div className="h-9 w-96 max-w-full shimmer-on-dark rounded-md mb-3" />
            {/* Cierre + badge completeness */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="h-5 w-40 shimmer-on-dark rounded" />
              <div className="h-6 w-32 shimmer-on-dark rounded-full" />
            </div>
            {/* Chips de peer group */}
            <div className="flex items-center gap-2 mt-6 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider opacity-70 font-medium">
                Comparativa:
              </span>
              {[140, 120, 105, 130, 115].map((w, i) => (
                <div
                  key={i}
                  className="h-7 shimmer-on-dark rounded-full"
                  style={{ width: `${w}px` }}
                />
              ))}
            </div>
          </div>
          {/* Botones de acción — reales pero disabled */}
          <div className="flex flex-col gap-2 flex-shrink-0">
            <button
              disabled
              className="h-10 px-4 rounded-lg bg-white/95 text-brand-800 font-semibold text-sm flex items-center gap-2 shadow-sm opacity-60 cursor-wait"
            >
              <Download className="w-4 h-4" />
              Descargar PDF
            </button>
            <button
              disabled
              className="h-10 px-4 rounded-lg border border-white/40 text-white text-sm flex items-center gap-2 opacity-60 cursor-wait"
            >
              <HelpCircle className="w-4 h-4" />
              Cómo usar el Benchmark
            </button>
          </div>
        </div>
      </header>

      {/* ============ SELECTORES — labels reales + controls shimmer ============ */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-6 flex-wrap shadow-sm">
        {[
          { label: "PERIODO", w: 160 },
          { label: "RESALTAR", w: 200 },
          { label: "COMPARAR CON", w: 220 },
          { label: "RENOMBRES", w: 140 },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
              {s.label}
            </span>
            <div
              className="h-9 shimmer rounded border border-slate-200"
              style={{ width: `${s.w}px` }}
            />
          </div>
        ))}
      </div>

      {/* ============ CUADRO RESUMEN — titulo real + tabla shimmer ============ */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-bold text-white inline-block px-4 py-2 rounded bg-gradient-to-r from-brand-900 to-brand-700 shadow-md">
            Cuadro Resumen
          </h2>
          <div className="flex items-center gap-3 text-xs">
            <span className="uppercase tracking-wider text-slate-500 font-semibold">
              vs pares
            </span>
            {[
              { label: "Mejor 25%", cls: "bg-emerald-100 text-emerald-800" },
              { label: "Sobre mediana", cls: "bg-emerald-50 text-emerald-700" },
              { label: "Bajo mediana", cls: "bg-amber-50 text-amber-700" },
              { label: "Peor 25%", cls: "bg-rose-100 text-rose-800" },
            ].map((c) => (
              <span
                key={c.label}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${c.cls} opacity-70`}
              >
                {c.label}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
          {/* Header de columnas — nombres reales de placeholders */}
          <div className="grid grid-cols-6 bg-slate-900 gap-4 px-4 py-3">
            <div className="col-span-1" />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-3 shimmer-on-dark rounded justify-self-end w-20" />
            ))}
          </div>

          {/* Sección con label real "DATOS GENERALES" */}
          <div className="bg-slate-100 px-4 py-2 border-t border-slate-200">
            <span className="text-[11px] uppercase tracking-wider font-bold text-slate-700">
              Datos Generales
            </span>
          </div>

          {/* Filas — nombres reales de indicadores + cells shimmer */}
          {[
            "N de agencias",
            "N de Clientes de Crédito",
            "N de personal",
            "% Part. Colocaciones",
            "Cartera Total",
          ].map((label, row) => (
            <div
              key={label}
              className="grid grid-cols-6 gap-4 px-4 py-3 border-t border-slate-100 items-center"
            >
              <div className="col-span-1 flex items-center gap-2 text-sm text-slate-700">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                {label}
              </div>
              {[0, 1, 2, 3, 4].map((cell) => (
                <div
                  key={cell}
                  className="h-4 shimmer rounded justify-self-end"
                  style={{ width: `${58 + ((row * 11 + cell * 7) % 34)}px` }}
                />
              ))}
            </div>
          ))}

          {/* Sección adicional realista */}
          <div className="bg-slate-100 px-4 py-2 border-t border-slate-200">
            <span className="text-[11px] uppercase tracking-wider font-bold text-slate-700">
              Rentabilidad
            </span>
          </div>
          {["ROE", "ROA", "Margen Financiero"].map((label, row) => (
            <div
              key={label}
              className="grid grid-cols-6 gap-4 px-4 py-3 border-t border-slate-100 items-center"
            >
              <div className="col-span-1 flex items-center gap-2 text-sm text-slate-700">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                {label}
              </div>
              {[0, 1, 2, 3, 4].map((cell) => (
                <div
                  key={cell}
                  className="h-4 shimmer rounded justify-self-end"
                  style={{ width: `${50 + ((row * 13 + cell * 9) % 30)}px` }}
                />
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Hint contextual rotante — el usuario ve QUE esta pasando */}
      <LoadingHint />
    </div>
  );
}
