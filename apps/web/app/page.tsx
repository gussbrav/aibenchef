import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-3xl text-center space-y-8">
        <span className="inline-block px-4 py-1.5 text-xs font-semibold tracking-widest text-brand-700 bg-brand-50 rounded-full uppercase">
          En construccion · Beta privada
        </span>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-slate-900">
          Aibenchef
        </h1>
        <p className="text-xl md:text-2xl text-slate-600 leading-relaxed">
          Inteligencia financiera para el sistema bancario peruano. Toda la data publica
          de la SBS, limpia, comparada y lista para decidir.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
          <Link
            href="/waitlist"
            className="px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg transition-colors"
          >
            Unirme a la waitlist
          </Link>
          <Link
            href="/api/health"
            className="px-8 py-3 border border-slate-300 hover:border-slate-400 text-slate-700 font-medium rounded-lg transition-colors"
          >
            Estado del servicio
          </Link>
        </div>
        <p className="text-sm text-slate-500 pt-8">
          Lanzamiento beta · {new Date().getFullYear()}
        </p>
      </div>
    </main>
  );
}
