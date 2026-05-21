import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Waitlist",
  description: "Sumate a la waitlist y te avisamos cuando lance Aibenchef.",
};

export default function WaitlistPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-xl w-full space-y-8">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900"
        >
          ← Volver
        </Link>
        <div className="space-y-3">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900">
            Sumate a la waitlist
          </h1>
          <p className="text-lg text-slate-600">
            Te aviso por mail cuando Aibenchef este disponible. Los primeros en la lista
            entran al beta con 50% off el primer trimestre.
          </p>
        </div>
        <form className="space-y-4" action="/api/waitlist" method="post">
          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium text-slate-700">
              Tu email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="tu@empresa.com"
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="org" className="text-sm font-medium text-slate-700">
              Empresa o institucion (opcional)
            </label>
            <input
              id="org"
              name="org"
              type="text"
              placeholder="Ej: Caja Arequipa, MEF, consultora..."
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <button
            type="submit"
            className="w-full px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-medium rounded-lg transition-colors"
          >
            Quiero acceso temprano
          </button>
        </form>
        <p className="text-xs text-slate-500 text-center">
          No spam. Solo te avisamos cuando este listo.
        </p>
      </div>
    </main>
  );
}
