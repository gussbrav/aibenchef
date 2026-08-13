/**
 * Loading skeleton del /dashboard/informe.
 *
 * Se muestra durante el SSR de page.tsx (que puede tardar 5-15s en cache
 * miss porque getInformeData toca 12+ MVs). Skeleton estructural para que
 * el usuario perciba progreso (no pantalla blanca ni spinner suelto).
 *
 * Sobrescribe el loading.tsx generico de /dashboard porque el /informe
 * tiene una estructura muy especifica (hero + selectores + cuadro + PE +
 * bubble + waterfalls + accordion historico) y un skeleton que se parezca
 * al layout final baja el CLS percibido a cero.
 */

export default function InformeLoading() {
  return (
    <div className="max-w-[1600px] mx-auto px-4 space-y-6 animate-pulse">
      {/* Hero */}
      <div className="rounded-xl bg-gradient-to-br from-brand-800 to-brand-700 p-8 space-y-4">
        <div className="h-3 w-40 bg-white/20 rounded" />
        <div className="h-8 w-96 bg-white/25 rounded" />
        <div className="h-4 w-64 bg-white/20 rounded" />
        <div className="flex gap-2 pt-2">
          <div className="h-6 w-32 bg-white/20 rounded-full" />
          <div className="h-6 w-32 bg-white/20 rounded-full" />
          <div className="h-6 w-32 bg-white/20 rounded-full" />
        </div>
      </div>

      {/* Toolbar de selectores */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap gap-4">
        <div className="h-9 w-48 bg-slate-100 rounded" />
        <div className="h-9 w-48 bg-slate-100 rounded" />
        <div className="h-9 w-32 bg-slate-100 rounded" />
        <div className="h-9 w-32 bg-slate-100 rounded" />
      </div>

      {/* Cuadro Resumen — tabla 5 columnas × 8 filas */}
      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200">
          <div className="h-5 w-40 bg-slate-200 rounded" />
        </div>
        <div className="p-5 space-y-3">
          {/* Header row */}
          <div className="grid grid-cols-6 gap-4">
            <div className="h-4 col-span-2 bg-slate-200 rounded" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-4 bg-slate-100 rounded" />
            ))}
          </div>
          {/* Data rows */}
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="grid grid-cols-6 gap-4">
              <div className="h-3 col-span-2 bg-slate-100 rounded" />
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="h-3 bg-slate-100 rounded" />
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Punto de Equilibrio + Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="h-5 w-52 bg-slate-200 rounded" />
          <div className="h-64 bg-slate-100 rounded" />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="h-5 w-52 bg-slate-200 rounded" />
          <div className="h-64 bg-slate-100 rounded" />
        </div>
      </div>

      {/* Progreso textual — feedback minimo si el skeleton dura */}
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500 not-animate-pulse">
        <div
          className="w-4 h-4 border-2 border-brand-600 border-t-transparent rounded-full animate-spin"
          aria-label="Cargando"
        />
        <span>Preparando tu informe…</span>
      </div>
    </div>
  );
}
