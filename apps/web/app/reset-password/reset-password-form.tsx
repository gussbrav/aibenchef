"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Lock } from "lucide-react";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [estado, setEstado] = useState<"check" | "form" | "ok" | "error">(
    "check",
  );
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!token) {
      setEstado("error");
      setError("No se proporciono ningun token. Verifica el link.");
      return;
    }
    (async () => {
      try {
        const r = await fetch(
          `/api/v1/auth/admin-reset-password?token=${encodeURIComponent(token)}`,
        );
        const json = await r.json();
        if (json.error || !json.data) {
          setEstado("error");
          setError("Token invalido, ya usado o expirado. Pide al admin que te envie un nuevo link.");
          return;
        }
        setEmail(json.data.email);
        setEstado("form");
      } catch (e) {
        setEstado("error");
        setError(String(e));
      }
    })();
  }, [token]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch("/api/v1/auth/admin-reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error");
      } else {
        setEstado("ok");
        setTimeout(() => router.push("/login"), 2500);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setEnviando(false);
    }
  };

  if (estado === "check") {
    return (
      <div className="text-center py-6">
        <Loader2 className="w-6 h-6 animate-spin mx-auto text-brand-600 mb-2" />
        <p className="text-sm text-slate-600">Verificando link...</p>
      </div>
    );
  }

  if (estado === "error") {
    return (
      <div className="text-center py-6">
        <div className="p-3 bg-rose-50 border border-rose-200 rounded text-sm text-rose-700">
          {error}
        </div>
      </div>
    );
  }

  if (estado === "ok") {
    return (
      <div className="text-center py-6 space-y-3">
        <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600" />
        <p className="text-sm text-slate-700">
          Contraseña actualizada. Redirigiendo al login...
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div className="p-3 bg-sky-50 border border-sky-200 rounded text-xs text-sky-900">
        Vas a restablecer la contraseña de <strong>{email}</strong>.
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Nueva contraseña
        </label>
        <div className="relative">
          <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimo 8 caracteres"
            className="w-full h-10 pl-9 pr-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
            autoFocus
            required
            minLength={8}
            maxLength={256}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Confirmar contraseña
        </label>
        <div className="relative">
          <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repite la contraseña"
            className="w-full h-10 pl-9 pr-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
            required
            minLength={8}
            maxLength={256}
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
        disabled={enviando || !password || !confirm}
        className="w-full h-10 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded inline-flex items-center justify-center gap-2"
      >
        {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
        Cambiar contraseña
      </button>
    </form>
  );
}
