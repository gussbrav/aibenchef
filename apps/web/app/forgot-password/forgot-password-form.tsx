"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error al procesar la solicitud");
      } else {
        setEnviado(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div className="text-center py-6 space-y-3">
        <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600" />
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-900">Revisa tu email</p>
          <p className="text-sm text-slate-600 leading-relaxed">
            Si <span className="font-mono">{email}</span> tiene una cuenta, te enviamos un link
            para elegir una nueva contrasena. El link expira en 1 hora.
          </p>
          <p className="text-xs text-slate-500 mt-4">
            No lo ves? Revisa la carpeta de spam. O intentalo de nuevo en 1 minuto.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email</label>
        <div className="relative">
          <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@correo.com"
            className="w-full h-10 pl-9 pr-3 text-sm rounded border border-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none transition-colors"
            required
            autoFocus
            autoComplete="email"
          />
        </div>
      </div>
      {error && (
        <div className="p-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={enviando || !email.trim()}
        className="w-full h-10 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded inline-flex items-center justify-center gap-2 transition-colors"
      >
        {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
        Enviar link de reset
      </button>
      <p className="text-[11px] text-slate-500 text-center leading-relaxed">
        Por seguridad, no confirmamos si el email esta registrado o no. Si tienes cuenta,
        el link te llega en unos segundos.
      </p>
    </form>
  );
}
