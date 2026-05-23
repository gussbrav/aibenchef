// not-found global. Cualquier notFound() en page.tsx ([id]/page.tsx de
// tableros, notebooks, sheets, etc) cae aca cuando el recurso no existe
// o el usuario no tiene acceso.

import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <FileQuestion className="w-12 h-12 text-slate-400 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          No encontrado
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          El recurso que buscas no existe o ya no esta disponible.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center h-9 px-4 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded transition-colors"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
