"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowRight, Lock, Loader2, Sparkles } from "lucide-react";
import { Button, Input, PasswordInput } from "@/components/ui";
import { authClient } from "@/lib/auth/client";

type InvitationPreview = {
  email: string;
  role: "admin" | "usuario";
  expiresAt: string;
};

export function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Validar token al cargar
  useEffect(() => {
    if (!token) {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    fetch(`/api/v1/invitations/${encodeURIComponent(token)}/preview`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) {
          setPreviewError(json.error.message ?? "Invitacion invalida");
        } else {
          setInvitation(json.data as InvitationPreview);
        }
      })
      .catch((e) => setPreviewError(String(e)))
      .finally(() => setPreviewLoading(false));
  }, [token]);

  // Estado: sin token -> mensaje "solo por invitacion" + CTA a solicitar-acceso
  if (!token) {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
          <Lock className="w-6 h-6 text-amber-700" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Registro por invitacion</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Aibenchef es <strong>beta privado</strong>. Si ya tienes un link de invitacion,
          abrelo desde tu correo. Si todavia no, puedes solicitar acceso y te respondemos
          en 24–48h.
        </p>
        <Link
          href={"/solicitar-acceso" as never}
          className="inline-flex items-center justify-center gap-2 h-11 px-5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg transition w-full"
        >
          Solicitar acceso
          <ArrowRight className="w-4 h-4" />
        </Link>
        <div className="pt-1">
          <Link href="/login" className="text-brand-600 hover:underline font-medium text-sm">
            ¿Ya tienes cuenta? Entra
          </Link>
        </div>
      </div>
    );
  }

  if (previewLoading) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Validando invitacion...
      </div>
    );
  }

  if (previewError || !invitation) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-rose-700" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Invitacion invalida</h2>
        <p className="text-sm text-slate-600">
          {previewError ?? "Este link expiro o ya fue usado."} Pide al administrador
          que te envie una nueva invitacion.
        </p>
        <div className="pt-2">
          <Link href="/login" className="text-brand-600 hover:underline font-medium text-sm">
            ¿Ya tienes cuenta? Entra
          </Link>
        </div>
      </div>
    );
  }

  const fmtExpira = new Date(invitation.expiresAt).toLocaleDateString("es-PE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // 1. Crear cuenta via Better Auth con el email DE LA INVITACION
      const { error: authError } = await authClient.signUp.email({
        name: name.trim(),
        email: invitation!.email,
        password,
        callbackURL: "/dashboard",
      });

      if (authError) {
        setError(
          traducirError(authError.message ?? authError.code ?? "Error al crear cuenta"),
        );
        setLoading(false);
        return;
      }

      // 2. Aceptar la invitacion (asigna rol + consume token)
      const ar = await fetch(
        `/api/v1/invitations/${encodeURIComponent(token)}/accept`,
        { method: "POST" },
      );
      const arJson = await ar.json();
      if (arJson.error) {
        // La cuenta se creo pero no se asigno el rol. No es fatal — admin
        // puede asignar manualmente desde Settings.
        console.warn("accept invitation failed:", arJson.error);
      }

      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-violet-700 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-violet-900">
          <p className="font-semibold">Invitacion valida</p>
          <p>
            Email: <span className="font-mono">{invitation.email}</span>
            <br />
            Rol: <span className="font-mono">{invitation.role}</span> · Expira{" "}
            {fmtExpira}
          </p>
        </div>
      </div>

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
        <label className="block text-sm font-medium text-slate-700">Email</label>
        <Input
          type="email"
          value={invitation.email}
          readOnly
          disabled
          className="bg-slate-100 cursor-not-allowed"
        />
        <p className="text-xs text-slate-500">
          El email viene de la invitacion y no se puede cambiar.
        </p>
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
        <p className="text-xs text-slate-500">Usa 8+ caracteres. Mezcla letras y números.</p>
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
            Creando cuenta...
          </>
        ) : (
          "Crear cuenta"
        )}
      </Button>
    </form>
  );
}

function traducirError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("already exists") || m.includes("user_already_exists"))
    return "Ya existe una cuenta con ese email. Entra aquí en su lugar.";
  if (m.includes("password") && m.includes("short"))
    return "La contraseña es demasiado corta (mínimo 8 caracteres).";
  if (m.includes("invalid") && m.includes("email")) return "El email no es válido.";
  return msg;
}
