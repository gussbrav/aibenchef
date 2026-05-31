"use client";

import { useState } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Loader2,
  Mail,
  Send,
  User,
  Users,
} from "lucide-react";

const TAMANOS = [
  { value: "solo", label: "Solo yo" },
  { value: "2-10", label: "2 a 10 personas" },
  { value: "11-50", label: "11 a 50 personas" },
  { value: "51-200", label: "51 a 200 personas" },
  { value: "200+", label: "Mas de 200 personas" },
] as const;

type Tamano = (typeof TAMANOS)[number]["value"];

export function RequestAccessForm() {
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [rol, setRol] = useState("");
  const [tamano, setTamano] = useState<Tamano | "">("");
  const [casoUso, setCasoUso] = useState("");
  // Honeypot — debe quedar vacio. Si un bot lo llena, rechazamos en server.
  const [website, setWebsite] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !nombre.trim() || !empresa.trim()) {
      setError("Email, nombre y empresa son obligatorios.");
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch("/api/v1/auth/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          nombre: nombre.trim(),
          empresa: empresa.trim(),
          rol: rol.trim() || null,
          tamanoEquipo: tamano || null,
          casoUso: casoUso.trim() || null,
          source: "solicitar_acceso_page",
          website,
        }),
      });
      const json = await r.json();
      if (json.error) {
        setError(json.error.message ?? "Error enviando solicitud");
        return;
      }
      setEnviado(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div className="text-center py-6 space-y-4">
        <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Solicitud recibida</h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
          Gracias, <strong>{nombre.trim()}</strong>. Te vamos a responder a{" "}
          <strong>{email.trim()}</strong> en 24–48h hábiles con un link único de signup.
          Si tu empresa ya está en nuestro programa, vas a recibir el acceso de inmediato.
        </p>
        <div className="pt-2">
          <a
            href="https://www.linkedin.com/company/azoramind/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-brand-600 hover:underline"
          >
            Mientras tanto, seguinos en LinkedIn →
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      {/* Honeypot: invisible para humanos via tabindex/aria/CSS. Bots lo llenan. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", overflow: "hidden" }}
      >
        <label>
          Sitio web (no completar)
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          label="Email corporativo *"
          icon={Mail}
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="tu@empresa.com"
          autoComplete="email"
          required
        />
        <Field
          label="Nombre completo *"
          icon={User}
          value={nombre}
          onChange={setNombre}
          placeholder="Maria Lopez"
          autoComplete="name"
          required
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          label="Empresa *"
          icon={Building2}
          value={empresa}
          onChange={setEmpresa}
          placeholder="Banco / Caja / Financiera"
          autoComplete="organization"
          required
        />
        <Field
          label="Cargo / rol"
          icon={User}
          value={rol}
          onChange={setRol}
          placeholder="Analista Riesgos · CFO · CIO"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
          Tamaño del equipo que va a usar Aibenchef
        </label>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
          {TAMANOS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTamano(t.value)}
              className={`px-2 py-2 text-[11px] rounded border transition ${
                tamano === t.value
                  ? "bg-brand-50 border-brand-400 text-brand-900 font-semibold"
                  : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Users className="w-3 h-3 inline mr-1 -mt-0.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
          ¿Para qué pensás usarlo? (opcional, pero ayuda a priorizar tu solicitud)
        </label>
        <textarea
          value={casoUso}
          onChange={(e) => setCasoUso(e.target.value)}
          rows={3}
          maxLength={1500}
          placeholder="Ej: Benchmark mensual contra CMACs. Reportes ejecutivos al directorio. Análisis de mora vs pares."
          className="w-full px-3 py-2 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none resize-none"
        />
        <p className="text-[10px] text-slate-400 mt-0.5 text-right">
          {casoUso.length}/1500
        </p>
      </div>

      {error && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="w-full h-11 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition"
      >
        {enviando ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Enviando solicitud...
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            Solicitar acceso
          </>
        )}
      </button>

      <p className="text-[11px] text-slate-500 text-center leading-relaxed">
        Procesamos tus datos solo para evaluar tu solicitud y, si aprobamos,
        habilitarte el acceso. Nunca te vamos a mandar marketing sin tu permiso
        explicito.
      </p>
    </form>
  );
}

function Field({
  label,
  icon: Icon,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  required,
}: {
  label: string;
  icon: typeof Mail;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <Icon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          className="w-full h-10 pl-9 pr-3 text-sm rounded border border-slate-300 focus:border-brand-500 outline-none"
        />
      </div>
    </div>
  );
}
