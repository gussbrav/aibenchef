"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  CreditCard,
  FileText,
  Landmark,
  Loader2,
  Sparkles,
  User as UserIcon,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * Modal profesional para contratar un plan pagado en fase manual (pre-Culqi).
 *
 * Recolecta datos minimos para emitir la factura + confirma metodo de pago,
 * luego abre WhatsApp con el mensaje pre-formateado listo para que Gustavo
 * responda con los datos bancarios y active el plan.
 *
 * Diseño premium (referencia Stripe/Linear checkout):
 *   - Progresion 2 pasos: datos -> resumen y WhatsApp
 *   - Toggle persona/empresa (empresa muestra RUC + razon social)
 *   - Toggle mensual/anual con calculo de ahorro real
 *   - 3 metodos de pago principales (Yape/Plin · Transferencia · PayPal)
 *   - Mensaje final claro sobre timeframe (activacion 24h) + cancelacion
 */

const AHORRO_ANUAL_PCT = 0.17;
const WHATSAPP_PHONE_RAW = "51941352492";

type Plan = {
  id: "free" | "pro" | "business";
  name: string;
  precioMensualPen: number;
  precioMensualUsd: number;
};

type TipoPersona = "natural" | "empresa";
type MetodoPago = "yape" | "transferencia" | "paypal";

const fmtPen = (n: number): string =>
  new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(n);

const fmtUsd = (n: number): string => `$${n.toLocaleString("en-US")}`;

export function ContratarPlanModal({
  plan,
  anualDefault = false,
  onClose,
}: {
  plan: Plan;
  anualDefault?: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [tipoPersona, setTipoPersona] = useState<TipoPersona>("natural");
  const [anual, setAnual] = useState<boolean>(anualDefault);
  const [metodo, setMetodo] = useState<MetodoPago>("transferencia");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [ruc, setRuc] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Cerrar con Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const precios = useMemo(() => {
    const mensualPen = anual
      ? Math.round(plan.precioMensualPen * (1 - AHORRO_ANUAL_PCT))
      : plan.precioMensualPen;
    const mensualUsd = anual
      ? Math.round(plan.precioMensualUsd * (1 - AHORRO_ANUAL_PCT))
      : plan.precioMensualUsd;
    const totalPen = anual ? mensualPen * 12 : mensualPen;
    const totalUsd = anual ? mensualUsd * 12 : mensualUsd;
    const ahorroPen = anual
      ? plan.precioMensualPen * 12 - plan.precioMensualPen * 12 * (1 - AHORRO_ANUAL_PCT)
      : 0;
    return { mensualPen, mensualUsd, totalPen, totalUsd, ahorroPen };
  }, [plan, anual]);

  const puedeAvanzar =
    nombre.trim().length >= 3 &&
    /^[^@]+@[^@]+\.[^@]+$/.test(email.trim()) &&
    (tipoPersona === "natural" ||
      (empresa.trim().length >= 3 && /^\d{11}$/.test(ruc.trim())));

  const construirMensaje = (): string => {
    const nombreLabel = tipoPersona === "empresa" ? "Razón social" : "Nombre";
    const nombreValor = tipoPersona === "empresa" ? empresa.trim() : nombre.trim();
    const rucLine = tipoPersona === "empresa" ? `🏢 RUC: ${ruc.trim()}\n` : "";
    const contactoLine = tipoPersona === "empresa" ? `👤 Contacto: ${nombre.trim()}\n` : "";
    const periodoLabel = anual ? "anual" : "mensual";
    const totalLabel = anual
      ? `${fmtPen(precios.totalPen)} anual (equivale a ${fmtPen(precios.mensualPen)}/mes con -17% vs mensual)`
      : `${fmtPen(precios.mensualPen)}/mes`;
    const metodoLabel = {
      yape: "Yape / Plin",
      transferencia: "Transferencia bancaria (BCP / Interbank / BBVA)",
      paypal: "PayPal (USD internacional)",
    }[metodo];

    return `Hola, quiero contratar Aibenchef ${plan.name} (${periodoLabel}).

📄 ${nombreLabel}: ${nombreValor}
${rucLine}${contactoLine}📧 Email: ${email.trim()}
💰 Total: ${totalLabel}
💳 Método: ${metodoLabel}

Quedo pendiente de las instrucciones de pago.`;
  };

  const confirmarYAbrirWhatsApp = () => {
    setEnviando(true);
    const msg = construirMensaje();
    const url = `https://wa.me/${WHATSAPP_PHONE_RAW}?text=${encodeURIComponent(msg)}`;
    // Timing: abrir en nueva pestaña + notificar exito al usuario en la modal.
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => {
      setEnviando(false);
      setStep(2);
    }, 400);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contratar-title"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4 bg-gradient-to-br from-brand-50 via-white to-white">
          <div>
            <p className="text-[11px] font-bold tracking-wider text-brand-700 uppercase inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Contratar plan
            </p>
            <h2 id="contratar-title" className="text-2xl font-bold text-slate-900 mt-1">
              Aibenchef {plan.name}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Activación en menos de 24 h · Sin permanencia · Factura electrónica peruana
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === 1 && (
          <>
            <div className="p-6 space-y-5">
              {/* Ciclo de facturación */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wider">
                  Ciclo de facturación
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <SelectableTile
                    active={!anual}
                    onClick={() => setAnual(false)}
                    title="Mensual"
                    subtitle={fmtPen(plan.precioMensualPen) + "/mes"}
                  />
                  <SelectableTile
                    active={anual}
                    onClick={() => setAnual(true)}
                    title="Anual"
                    subtitle={fmtPen(Math.round(plan.precioMensualPen * (1 - AHORRO_ANUAL_PCT))) + "/mes"}
                    badge="Ahorra 17%"
                  />
                </div>
              </div>

              {/* Tipo persona */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wider">
                  Tipo de comprobante
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <SelectableTile
                    active={tipoPersona === "natural"}
                    onClick={() => setTipoPersona("natural")}
                    icon={<UserIcon className="w-4 h-4" />}
                    title="Persona natural"
                    subtitle="Boleta electrónica"
                  />
                  <SelectableTile
                    active={tipoPersona === "empresa"}
                    onClick={() => setTipoPersona("empresa")}
                    icon={<Building2 className="w-4 h-4" />}
                    title="Empresa"
                    subtitle="Factura electrónica"
                  />
                </div>
              </div>

              {/* Datos */}
              {tipoPersona === "empresa" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field
                    label="Razón social"
                    value={empresa}
                    onChange={setEmpresa}
                    placeholder="Consultora Alfa SAC"
                    autoFocus
                  />
                  <Field
                    label="RUC"
                    value={ruc}
                    onChange={(v) => setRuc(v.replace(/\D/g, "").slice(0, 11))}
                    placeholder="20123456789"
                    inputMode="numeric"
                    hint="11 dígitos, sin guiones"
                  />
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field
                  label={tipoPersona === "empresa" ? "Contacto responsable" : "Nombre completo"}
                  value={nombre}
                  onChange={setNombre}
                  placeholder={tipoPersona === "empresa" ? "María Pérez" : "María Pérez"}
                  autoFocus={tipoPersona === "natural"}
                />
                <Field
                  label="Email"
                  value={email}
                  onChange={setEmail}
                  placeholder="maria@empresa.com"
                  type="email"
                  hint="Recibirás factura y activación acá"
                />
              </div>

              {/* Método de pago */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wider">
                  Método de pago
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <SelectableTile
                    active={metodo === "yape"}
                    onClick={() => setMetodo("yape")}
                    icon={<CreditCard className="w-4 h-4" />}
                    title="Yape / Plin"
                    subtitle="Activación 1 h"
                  />
                  <SelectableTile
                    active={metodo === "transferencia"}
                    onClick={() => setMetodo("transferencia")}
                    icon={<Landmark className="w-4 h-4" />}
                    title="Transferencia"
                    subtitle="BCP · IBK · BBVA"
                  />
                  <SelectableTile
                    active={metodo === "paypal"}
                    onClick={() => setMetodo("paypal")}
                    icon={<CreditCard className="w-4 h-4" />}
                    title="PayPal"
                    subtitle="USD internacional"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-2 inline-flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  Pagos con tarjeta (Visa/Mastercard) próximamente vía Culqi.
                </p>
              </div>

              {/* Resumen */}
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Total a pagar
                </p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-bold text-slate-900 tabular-nums">
                    {fmtPen(precios.totalPen)}
                  </span>
                  <span className="text-sm text-slate-500 tabular-nums">
                    ≈ {fmtUsd(precios.totalUsd)}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-1">
                  {anual ? (
                    <>
                      Facturado anualmente ·{" "}
                      <span className="text-emerald-700 font-semibold">
                        Ahorras {fmtPen(precios.ahorroPen)} vs mensual
                      </span>
                    </>
                  ) : (
                    <>Facturado mensualmente · IGV incluido</>
                  )}
                </p>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 h-10 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarYAbrirWhatsApp}
                disabled={!puedeAvanzar || enviando}
                className="px-5 h-10 text-sm font-semibold bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg inline-flex items-center justify-center gap-2 shadow-sm"
              >
                {enviando ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Abriendo WhatsApp...
                  </>
                ) : (
                  <>
                    Confirmar por WhatsApp
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="p-8 text-center">
              <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-600" strokeWidth={3} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mt-4">
                Solicitud enviada
              </h3>
              <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto leading-relaxed">
                Te acabamos de abrir WhatsApp con tu resumen pre-cargado. En cuanto lo mandes,
                te respondemos en menos de 1 hora con los datos bancarios exactos y activamos
                tu plan en menos de 24 horas.
              </p>
              <div className="mt-6 p-4 rounded-lg bg-slate-50 border border-slate-200 text-left space-y-2 max-w-md mx-auto">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Próximos pasos
                </p>
                <ul className="text-sm text-slate-700 space-y-1.5">
                  <li className="flex items-start gap-2">
                    <span className="text-brand-600 font-bold">1.</span>
                    Envíanos el mensaje pre-cargado en WhatsApp.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-brand-600 font-bold">2.</span>
                    Te enviamos los datos bancarios y el link de pago si aplica.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-brand-600 font-bold">3.</span>
                    Mandas el voucher y activamos tu plan + factura en menos de 24 h.
                  </li>
                </ul>
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-center">
              <button
                type="button"
                onClick={onClose}
                className="px-5 h-10 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg"
              >
                Cerrar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function SelectableTile({
  active,
  onClick,
  title,
  subtitle,
  icon,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left px-3 py-2.5 rounded-lg border transition-all relative",
        active
          ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500 shadow-sm"
          : "border-slate-200 hover:border-slate-300 bg-white",
      )}
    >
      {badge && (
        <span className="absolute -top-2 -right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white uppercase tracking-wider">
          {badge}
        </span>
      )}
      <div className="flex items-center gap-2">
        {icon && (
          <span className={cn(active ? "text-brand-600" : "text-slate-500")}>
            {icon}
          </span>
        )}
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        {active && <Check className="w-3.5 h-3.5 text-brand-600 ml-auto" />}
      </div>
      <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus,
  hint,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  hint?: string;
  inputMode?: "text" | "numeric" | "email";
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        inputMode={inputMode}
        className="w-full h-10 px-3 text-sm rounded-lg border border-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
      />
      {hint && <p className="text-[11px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}
