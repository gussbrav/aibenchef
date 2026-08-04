"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button, Input, PasswordInput } from "@/components/ui";
import { authClient } from "@/lib/auth/client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await authClient.signIn.email({
      email: email.trim().toLowerCase(),
      password,
      callbackURL: "/dashboard",
    });

    if (authError) {
      setError(traducirError(authError.message ?? authError.code ?? "Error de inicio de sesión"));
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@empresa.com"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Contraseña
          </label>
          <Link
            href={"/forgot-password" as never}
            className="text-xs text-brand-600 hover:text-brand-700 hover:underline font-medium"
          >
            ¿La olvidaste?
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Tu contraseña"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" size="lg" fullWidth disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Entrando...
          </>
        ) : (
          "Entrar"
        )}
      </Button>
    </form>
  );
}

function traducirError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid") && m.includes("password")) return "Email o contraseña incorrectos.";
  if (m.includes("invalid") && m.includes("email")) return "El email no es válido.";
  if (m.includes("not found") || m.includes("does not exist"))
    return "No encontramos una cuenta con ese email.";
  if (m.includes("network") || m.includes("failed to fetch"))
    return "Sin conexión. Reintenta en unos segundos.";
  return msg;
}
