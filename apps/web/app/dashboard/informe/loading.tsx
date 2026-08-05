/**
 * Skeleton premium del /dashboard/informe.
 *
 * Antes: spinner blanco genérico durante ~10s (getInformeData es la query
 * pesada, hace peer group + KPIs completos + serie historica) — sensacion
 * de app rota.
 *
 * Ahora: el usuario ve la estructura real del layout (hero azul, selectores,
 * cuadro resumen) con shimmer, matcheando exactamente lo que va a ver
 * cuando termine el fetch. La percepcion pasa de "roto" a "cargando".
 *
 * Este archivo es el fallback automatico del Suspense boundary implicito
 * que Next.js genera alrededor de page.tsx. Se muestra durante el fetch
 * server-side y se reemplaza cuando el server component termina.
 *
 * Convencion visual: bg gradiente identico al hero final (brand-900 -> brand-700),
 * chips y textos como <div bg-white/20 animate-pulse> para el shimmer.
 */
export default function InformeLoading() {
  return (
    <div className="max-w-[1400px] mx-auto space-y-5 px-2">
      {/* ============ HERO SKELETON ============ */}
      <header className="rounded-xl text-white p-8 relative overflow-hidden bg-gradient-to-br from-brand-900 to-brand-700">
        <div className="flex items-start justify-between gap-6 flex-wrap relative z-10">
          <div className="flex-1 min-w-0">
            <div className="h-3 w-56 bg-white/20 rounded animate-pulse mb-3" />
            <div className="h-9 w-96 max-w-full bg-white/25 rounded animate-pulse mb-3" />
            <div className="flex items-center gap-2 flex-wrap">
              <div className="h-5 w-36 bg-white/20 rounded animate-pulse" />
              <div className="h-6 w-32 bg-white/15 rounded-full animate-pulse" />
            </div>
            <div className="flex items-center gap-2 mt-5 flex-wrap">
              <div className="h-3 w-24 bg-white/20 rounded animate-pulse" />
              {[140, 120, 100, 130, 110].map((w) => (
                <div
                  key={w}
                  className="h-7 rounded-full bg-white/20 animate-pulse"
                  style={{ width: `${w}px` }}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <div className="h-10 w-44 bg-white/25 rounded-lg animate-pulse" />
            <div className="h-10 w-44 bg-white/15 rounded-lg animate-pulse" />
          </div>
        </div>
      </header>

      {/* ============ SELECTORES SKELETON ============ */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-4 flex-wrap">
        {[
          { label: 90, ctrl: 160 },
          { label: 80, ctrl: 200 },
          { label: 150, ctrl: 220 },
          { label: 60, ctrl: 140 },
        ].map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-4 rounded bg-slate-200 animate-pulse" style={{ width: `${s.label}px` }} />
            <div className="h-9 rounded bg-slate-100 animate-pulse" style={{ width: `${s.ctrl}px` }} />
          </div>
        ))}
      </div>

      {/* ============ CUADRO RESUMEN SKELETON ============ */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="h-10 w-52 rounded bg-gradient-to-r from-brand-900 to-brand-700 animate-pulse" />
          <div className="flex items-center gap-3">
            <div className="h-4 w-16 bg-slate-200 rounded animate-pulse" />
            {[70, 90, 80, 70].map((w) => (
              <div key={w} className="h-6 rounded-full bg-slate-100 animate-pulse" style={{ width: `${w}px` }} />
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-6 bg-slate-900 gap-4 px-4 py-3">
            <div className="col-span-1" />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-3 rounded bg-white/25 animate-pulse" />
            ))}
          </div>
          {/* Section band */}
          <div className="bg-slate-100 px-4 py-2">
            <div className="h-3 w-32 rounded bg-slate-300 animate-pulse" />
          </div>
          {/* Data rows */}
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="grid grid-cols-6 gap-4 px-4 py-3 border-t border-slate-100">
              <div className="col-span-1 h-4 rounded bg-slate-200 animate-pulse" />
              {[0, 1, 2, 3, 4].map((cell) => (
                <div
                  key={cell}
                  className="h-4 rounded bg-slate-100 animate-pulse justify-self-end"
                  style={{ width: `${60 + ((row * 13 + cell * 7) % 40)}px` }}
                />
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Hint sutil — que el usuario sepa que esta cargando data real, no
          que la app esta rota. Aparece SOLO en el skeleton, desaparece al
          renderizar el componente final. */}
      <p className="text-center text-xs text-slate-400 pt-2 animate-pulse">
        Cargando benchmark…
      </p>
    </div>
  );
}
