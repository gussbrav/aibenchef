// Loading boundary del segmento /dashboard. Se muestra mientras los
// server components hacen fetch de datos (page.tsx con drizzle queries).
// Sin esto, el usuario ve pantalla anterior estatica + nada hasta que
// el HTML completo del nuevo route llega.

export default function DashboardLoading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <div
          className="w-4 h-4 border-2 border-brand-600 border-t-transparent rounded-full animate-spin"
          aria-label="Cargando"
        />
        <span>Cargando...</span>
      </div>
    </div>
  );
}
