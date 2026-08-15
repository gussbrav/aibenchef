"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowRight, Loader2, Sparkles } from "lucide-react";

import { Button, Input, PasswordInput } from "@/components/ui";
import { authClient } from "@/lib/auth/client";
import { isEmailAcademicoPeruano } from "@/lib/plans";

/**
 * SignupForm — 2 modos:
 *
 *   A. Self-serve (default, sin ?token en URL):
 *      - Google OAuth 1-click (si GOOGLE_CLIENT_ID esta en env — check
 *        via prop `googleEnabled` que la page.tsx pasa desde el server)
 *      - Email/password abierto: cualquiera crea cuenta gratis
 *      - Post-signup -> /dashboard (plan Free asignado por default)
 *
 *   B. Invitation flow (con ?token=... en URL):
 *      - Valida el token contra /api/v1/invitations/{token}/preview
 *      - Muestra el email pre-cargado + rol + expiracion
 *      - Post-signup -> POST /api/v1/invitations/{token}/accept -> /dashboard
 *
 * Cero cambios en la logica de invitations existente — se preserva 100%.
 */

type InvitationPreview = {
  email: string;
  role: "admin" | "usuario";
  expiresAt: string;
};

export function SignupForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(!!token);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Si viene token, validar la invitacion primero
  useEffect(() => {
    if (!token) return;
    setPreviewLoading(true);
    fetch(`/api/v1/invitations/${encodeURIComponent(token)}/preview`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) {
          setPreviewError(json.error.message ?? "Invitación inválida");
        } else {
          setInvitation(json.data as InvitationPreview);
        }
      })
      .catch((e) => setPreviewError(String(e)))
      .finally(() => setPreviewLoading(false));
  }, [token]);

  // Estado: token invalido/expirado
  if (token && previewLoading) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Validando invitación...
      </div>
    );
  }
  if (token && (previewError || !invitation)) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-rose-700" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Invitación inválida</h2>
        <p className="text-sm text-slate-600">
          {previewError ?? "Este link expiró o ya fue usado."}
        </p>
        <div className="pt-2 space-y-2">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 h-11 px-5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg transition w-full"
          >
            Crear cuenta gratis sin invitación
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link href="/login" className="block text-brand-600 hover:underline font-medium text-sm">
            ¿Ya tienes cuenta? Entra
          </Link>
        </div>
      </div>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Determinar email: si hay invitacion, viene de ella; sino del form
      const finalEmail = invitation ? invitation.email : email.trim().toLowerCase();

      const { error: authError } = await authClient.signUp.email({
        name: name.trim(),
        email: finalEmail,
        password,
        callbackURL: "/dashboard",
      });

      if (authError) {
        setError(traducirError(authError.message ?? authError.code ?? "Error al crear cuenta"));
        setLoading(false);
        return;
      }

      // Si hay invitacion, consumirla ahora (asigna rol)
      if (token) {
        const ar = await fetch(
          `/api/v1/invitations/${encodeURIComponent(token)}/accept`,
          { method: "POST" },
        );
        const arJson = await ar.json();
        if (arJson.error) {
          console.warn("accept invitation failed:", arJson.error);
        }
      }

      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  async function onGoogleClick() {
    setError(null);
    setGoogleLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: "/dashboard",
      });
      // Si el OAuth redirect toma el control del browser esto no continua.
      // Si fallo silenciosamente, quitamos loading.
      setGoogleLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGoogleLoading(false);
    }
  }

  const isInviteMode = !!invitation;
  const fmtExpira = invitation
    ? new Date(invitation.expiresAt).toLocaleDateString("es-PE", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <div className="space-y-5">
      {/* Banner: modo invitacion */}
      {isInviteMode && (
        <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-violet-700 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-violet-900">
            <p className="font-semibold">Invitación válida</p>
            <p className="mt-0.5">
              Email: <span className="font-mono">{invitation!.email}</span> · Rol:{" "}
              <span className="font-mono">{invitation!.role}</span>
              <br />
              Expira: {fmtExpira}
            </p>
          </div>
        </div>
      )}

      {/* Google OAuth (solo self-serve mode + si esta habilitado) */}
      {!isInviteMode && googleEnabled && (
        <>
          <button
            type="button"
            onClick={onGoogleClick}
            disabled={googleLoading || loading}
            className="w-full h-11 px-4 flex items-center justify-center gap-3 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 transition shadow-sm"
          >
            {googleLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <GoogleLogo className="w-4 h-4" />
            )}
            Continuar con Google
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-slate-500 uppercase tracking-wider font-medium">
                o con email
              </span>
            </div>
          </div>
        </>
      )}

      {/* Form email/password */}
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="name" className="block text-sm font-medium text-slate-700">
            Nombre completo
          </label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre y apellido"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email {isInviteMode && <span className="text-slate-400 font-normal">(de la invitación)</span>}
          </label>
          {isInviteMode ? (
            <Input
              type="email"
              value={invitation!.email}
              readOnly
              disabled
              className="bg-slate-100 cursor-not-allowed"
            />
          ) : (
            <>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@empresa.com o tu@universidad.edu.pe"
              />
              {/* V172: si es email .edu.pe informamos que califica para
                  descuento tesista al pagar Academic (S/29/mes vs S/149),
                  pero NO auto-asignamos el plan (eso era regalar features).
                  El descuento se aplica al momento de contratar via WhatsApp. */}
              {isEmailAcademicoPeruano(email) && (
                <div className="mt-2 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 flex items-start gap-2 text-[12px] text-sky-900">
                  <span className="text-sky-600 font-bold">🎓</span>
                  <span>
                    <strong>Email institucional detectado.</strong> Tu cuenta
                    empieza en el plan Free como todos. Cuando quieras contratar
                    Pro, calificas por el <strong>descuento tesista: S/29/mes</strong>{" "}
                    en lugar de S/149 (verificación automática al pagar).
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Contraseña
          </label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
          />
          <p className="text-[11px] text-slate-500">Usa 8 o más caracteres. Mezcla letras y números.</p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" size="lg" fullWidth disabled={loading || googleLoading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creando cuenta...
            </>
          ) : (
            <>
              Crear cuenta gratis
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </Button>

        {!isInviteMode && (
          <p className="text-[11px] text-slate-500 text-center leading-relaxed">
            Sin tarjeta requerida. Plan Free gratis siempre. Puedes subir a Pro cuando lo necesites.
          </p>
        )}
      </form>
    </div>
  );
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function traducirError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("already exists") || m.includes("user_already_exists") || m.includes("email_already_in_use"))
    return "Ya existe una cuenta con ese email. Entra desde el link 'Entra aquí'.";
  if (m.includes("password") && m.includes("short"))
    return "La contraseña es demasiado corta (mínimo 8 caracteres).";
  if (m.includes("invalid") && m.includes("email")) return "El email no es válido.";
  if (m.includes("network") || m.includes("failed to fetch"))
    return "Sin conexión. Reintenta en unos segundos.";
  return msg;
}
