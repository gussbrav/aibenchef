"use client";

/**
 * Manual del Informe Benchmark — version ejecutiva.
 * Diseño premium tipo one-pager de consultora: 4-5 secciones cortas,
 * mucho whitespace, iconos grandes, cero jerga tecnica. Un gerente lo
 * lee en 5 minutos.
 */

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Building2,
  Download,
  FileText,
  Lightbulb,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";

const APP_NAME = "Aibenchef";
const GENERATED = new Date().toLocaleDateString("es-PE", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function ManualInformeClient() {
  const [exportando, setExportando] = useState(false);

  const onExport = () => {
    if (exportando) return;
    setExportando(true);
    setTimeout(() => {
      window.print();
      setTimeout(() => setExportando(false), 800);
    }, 200);
  };

  return (
    <>
      {/* Portada solo-print */}
      <ManualCover />

      {/* Barra superior en pantalla */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 screen-only">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <Link
            href="/dashboard/informe"
            className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver al Benchmark
          </Link>
          <button
            type="button"
            onClick={onExport}
            disabled={exportando}
            className="inline-flex items-center gap-2 h-10 px-5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-medium rounded-md shadow-sm transition-colors"
          >
            {exportando ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {exportando ? "Preparando…" : "Descargar PDF"}
          </button>
        </div>
      </div>

      <article className="manual-body max-w-3xl mx-auto px-4 sm:px-6 pb-16">
        {/* Hero */}
        <header className="manual-hero">
          <p className="manual-kicker">Manual del usuario</p>
          <h1 className="manual-h1">
            El Benchmark<br />
            en <span className="manual-h1-accent">5 minutos</span>
          </h1>
          <p className="manual-lede">
            Guía rápida para gerentes. Cómo abrir tu informe, entenderlo en un vistazo y compartirlo con tu equipo — sin fricción.
          </p>
        </header>

        {/* Qué vas a lograr */}
        <section className="manual-outcomes">
          <h2 className="manual-h2">Al terminar este manual vas a poder</h2>
          <ol className="manual-outcomes-list">
            <li>
              <span className="manual-outcome-num">1</span>
              <div>
                <strong>Abrir tu informe</strong> y saber qué mirar primero.
              </div>
            </li>
            <li>
              <span className="manual-outcome-num">2</span>
              <div>
                <strong>Interpretar el análisis competitivo</strong> — cómo estás vs los otros 4 del grupo.
              </div>
            </li>
            <li>
              <span className="manual-outcome-num">3</span>
              <div>
                <strong>Generar y descargar un PDF ejecutivo</strong> para presentar al directorio.
              </div>
            </li>
          </ol>
        </section>

        {/* Paso 1 — Abrir el informe */}
        <StepSection number={1} icon={Building2} title="Abre tu informe">
          <p>
            Al entrar a la plataforma, ve al menú <strong>Benchmark</strong>. Aterrizas directo en el informe
            de tu entidad — configurado con tu peer group, colores y período más reciente.
          </p>
          <ol className="manual-numbered">
            <li>Click en <strong>Benchmark</strong> en la barra superior.</li>
            <li>Verifica arriba: nombre de tu entidad + período del cierre.</li>
            <li>Los 5 chips de colores son tu grupo comparable — la 1ra suele ser la tuya.</li>
          </ol>
          <Tip>
            Si quieres que tu cliente aparezca por defecto sin tipear la URL, configuralo en
            <em> Configuración → Mi perfil → Cliente por defecto.</em>
          </Tip>
        </StepSection>

        {/* Paso 2 — Leer el resumen */}
        <StepSection number={2} icon={Search} title="Lee el Cuadro Resumen">
          <p>
            Es la primera tabla del informe. Muestra los KPIs clave (cartera, mora, ROE, ROA, utilidad)
            <strong> lado a lado por entidad</strong>. Es la foto general — en 30 segundos ya sabes cómo estás.
          </p>
          <ol className="manual-numbered">
            <li><strong>Tu columna</strong> es la primera después del label. Mírala contra las otras 4.</li>
            <li>Busca diferencias grandes — si tu mora es 6% y las demás 4%, ahí hay tema.</li>
            <li>Si algún número aparece como <span className="manual-mono">"—"</span>, es que la SBS aún no publicó ese dato del mes.</li>
          </ol>
          <Tip>
            No te quedes solo con el Cuadro Resumen — abajo hay <strong>análisis de Margen Neto</strong> y
            <strong>20+ secciones históricas</strong> que explican <em>por qué</em> los números son como son.
          </Tip>
        </StepSection>

        {/* Paso 3 — Ver bubble chart */}
        <StepSection number={3} icon={BarChart3} title="Interpreta el mapa competitivo">
          <p>
            Debajo del resumen está el gráfico de burbujas de Margen Neto. Es el análisis más rico del
            informe — te dice de un vistazo <em>quién va ganando la carrera</em>.
          </p>
          <ol className="manual-numbered">
            <li><strong>Derecha</strong> del gráfico = mejora de eficiencia (bajaste costos).</li>
            <li><strong>Arriba</strong> del gráfico = mejora de rentabilidad (cobras más por lo que prestas).</li>
            <li>La <strong>esquina superior derecha</strong> es la posición ideal: ambos motores mejorando.</li>
            <li>El <strong>tamaño</strong> de la burbuja es tu Margen Neto actual — más grande = más rentable.</li>
          </ol>
          <Tip>
            Debajo del bubble chart hay 2 cascadas que descomponen el cambio del margen en sus 5 componentes
            (Rendimiento, Fondeo, Provisiones, Gastos, Otros). Verde suma, rojo resta.
          </Tip>
        </StepSection>

        {/* Paso 4 — Insights IA */}
        <StepSection number={4} icon={Sparkles} title="Pide análisis al experto (IA)">
          <p>
            En varias secciones vas a ver un panel <strong>"Análisis del experto"</strong>. Es un análisis
            ejecutivo generado por inteligencia artificial usando los datos exactos que ves en pantalla,
            con el tono editorial de un analista financiero senior del sector.
          </p>
          <ol className="manual-numbered">
            <li>Busca el panel — está debajo de cada gráfico principal.</li>
            <li>Click en <strong>"Generar análisis con IA"</strong>. En 3-5 segundos aparecen los bullets.</li>
            <li>Cada bullet cierra con <strong>Implica</strong>, <strong>Acción</strong>, <strong>Riesgo</strong> u <strong>Oportunidad</strong>.</li>
          </ol>
          <Warning>
            El análisis es de apoyo. No reemplaza tu criterio ni constituye recomendación de inversión.
            Siempre verifica las cifras contra la fuente SBS original.
          </Warning>
        </StepSection>

        {/* Paso 5 — Descargar PDF */}
        <StepSection number={5} icon={FileText} title="Descarga el PDF para tu directorio">
          <p>
            El botón <strong>"Descargar PDF"</strong> arriba a la derecha genera un informe ejecutivo
            completo, con portada corporativa, encabezado y pie profesional, y todas las secciones cargadas.
          </p>
          <ol className="manual-numbered">
            <li>Click en <strong>Descargar PDF</strong>. Espera 5-10 segundos (el sistema abre todas las secciones y las carga).</li>
            <li>Se abre el diálogo del navegador. Elige <strong>"Guardar como PDF"</strong>.</li>
            <li>Verifica que esté en <strong>Horizontal</strong> y con <strong>"Gráficos de fondo"</strong> activado.</li>
            <li>Click <strong>Guardar</strong>. Elige la carpeta.</li>
          </ol>
          <Tip>
            En "Más ajustes" del diálogo, <strong>desactiva "Encabezados y pies de página"</strong>. Si no,
            Chrome pone su propio encabezado feo encima del nuestro premium.
          </Tip>
        </StepSection>

        {/* FAQ minimalista */}
        <section className="manual-faq">
          <h2 className="manual-h2">Preguntas rápidas</h2>

          <FaqItem q="¿La data está actualizada?">
            Sí. El sistema descarga los archivos SBS <strong>3 veces al día</strong> automáticamente. Si SBS
            publicó algo nuevo, aparece dentro de las 8 horas siguientes.
          </FaqItem>

          <FaqItem q="¿Por qué algunos números aparecen en '—'?">
            SBS publica los archivos con retraso variable (mora, cobertura CAR, etc. suelen aparecer días
            después del cierre principal). Cuando SBS los publique, van a aparecer automáticamente.
          </FaqItem>

          <FaqItem q="¿Puedo cambiar mi peer group?">
            Sí. En los selectores arriba del Cuadro Resumen, click <em>Editar</em> en Peer Group. Puedes
            comparar contra las entidades que quieras, siempre 5 en total.
          </FaqItem>

          <FaqItem q="Olvidé mi contraseña, ¿qué hago?">
            En la pantalla de login, click <em>"¿La olvidaste?"</em>. Ingresas tu email y recibes un link
            para elegir una nueva. El link expira en 1 hora.
          </FaqItem>
        </section>

        {/* Glosario mini */}
        <section className="manual-glossary-section">
          <h2 className="manual-h2">Glosario mínimo</h2>
          <p className="manual-glossary-intro">
            Los 6 términos que aparecen todo el tiempo:
          </p>
          <dl className="manual-glossary">
            <dt>Peer group</dt>
            <dd>Grupo de 5 entidades contra las que se compara la tuya. Una por tipo SBS.</dd>

            <dt>Mora</dt>
            <dd>% de la cartera de créditos que está impaga.</dd>

            <dt>Margen Neto</dt>
            <dd>Cuánto queda de cada sol de ingreso después de todos los gastos.</dd>

            <dt>ROE / ROA</dt>
            <dd>Rentabilidad sobre patrimonio / sobre activos. Anualizado (últimos 12 meses).</dd>

            <dt>bps</dt>
            <dd>Basis points. 100 bps = 1%. Se usan para variaciones finas.</dd>

            <dt>Cobertura CAR</dt>
            <dd>Cuánto colchón (provisiones) tienes contra los créditos malos. &gt;100% = deseable.</dd>
          </dl>
        </section>

        {/* Cierre */}
        <section className="manual-cierre">
          <div className="manual-cierre-rule" />
          <p className="manual-cierre-text">
            <strong>Listo.</strong> Con esto ya puedes abrir el Benchmark, interpretarlo y presentarlo.
            Si tienes dudas, contacta al administrador de tu cuenta.
          </p>
          <div className="manual-sign">
            <div>Manual del usuario · Informe Benchmark</div>
            <div>{APP_NAME} · {GENERATED}</div>
          </div>
        </section>
      </article>

      {/* Estilos del manual — enfoque premium simple */}
      <style jsx>{`
        .manual-body {
          color: #1f2937;
          font-size: 16px;
          line-height: 1.7;
        }
        .manual-body :global(section) {
          margin: 44px 0;
        }
        .manual-body :global(p) {
          margin: 10px 0;
        }
        .manual-body :global(.manual-hero) {
          margin-top: 20px;
          margin-bottom: 50px;
          padding-bottom: 20px;
          border-bottom: 1px solid #e2e8f0;
        }
        .manual-body :global(.manual-kicker) {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          color: #64748b;
          font-weight: 700;
          margin-bottom: 12px;
        }
        .manual-body :global(.manual-h1) {
          font-family: Georgia, serif;
          font-size: 46px;
          font-weight: 700;
          color: #0f172a;
          line-height: 1.1;
          letter-spacing: -0.02em;
          margin: 0 0 16px;
        }
        .manual-body :global(.manual-h1-accent) {
          color: #2563eb;
          font-style: italic;
        }
        .manual-body :global(.manual-lede) {
          font-size: 18px;
          color: #475569;
          line-height: 1.5;
          max-width: 42rem;
          margin: 0;
        }
        .manual-body :global(.manual-h2) {
          font-family: Georgia, serif;
          font-size: 24px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 20px;
        }

        /* Bloque 'Al terminar podras' */
        .manual-body :global(.manual-outcomes) {
          background: linear-gradient(180deg, #f0f9ff 0%, #ffffff 100%);
          border: 1px solid #bae6fd;
          border-radius: 14px;
          padding: 28px;
        }
        .manual-body :global(.manual-outcomes-list) {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .manual-body :global(.manual-outcomes-list li) {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          padding: 12px 0;
          border-bottom: 1px solid #e0f2fe;
        }
        .manual-body :global(.manual-outcomes-list li:last-child) {
          border-bottom: none;
        }
        .manual-body :global(.manual-outcome-num) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #0369a1;
          color: white;
          font-weight: 700;
          font-size: 15px;
          flex-shrink: 0;
        }

        /* Steps con numero grande + icono */
        .manual-body :global(.manual-step-section) {
          display: block;
        }
        .manual-body :global(.manual-step-header) {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 2px solid #0f172a;
        }
        .manual-body :global(.manual-step-number) {
          font-family: Georgia, serif;
          font-size: 48px;
          font-weight: 700;
          color: #2563eb;
          line-height: 1;
          flex-shrink: 0;
        }
        .manual-body :global(.manual-step-icon) {
          width: 28px;
          height: 28px;
          color: #64748b;
          flex-shrink: 0;
        }
        .manual-body :global(.manual-step-title) {
          font-family: Georgia, serif;
          font-size: 26px;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
          flex: 1;
        }

        .manual-body :global(.manual-numbered) {
          list-style: decimal;
          padding-left: 28px;
          margin: 14px 0;
        }
        .manual-body :global(.manual-numbered li) {
          margin: 8px 0;
          padding-left: 4px;
        }
        .manual-body :global(.manual-bullets) {
          list-style: disc;
          padding-left: 24px;
          margin: 12px 0;
        }
        .manual-body :global(.manual-mono) {
          font-family: 'SF Mono', Consolas, monospace;
          font-size: 0.9em;
          background: #f1f5f9;
          padding: 1px 6px;
          border-radius: 4px;
          border: 1px solid #e2e8f0;
        }

        /* FAQ */
        .manual-body :global(.manual-faq) {
          background: #f8fafc;
          border-radius: 14px;
          padding: 28px;
          border: 1px solid #e2e8f0;
        }

        /* Glosario */
        .manual-body :global(.manual-glossary-intro) {
          color: #64748b;
          font-style: italic;
          margin-bottom: 20px;
        }
        .manual-body :global(.manual-glossary) {
          display: grid;
          grid-template-columns: 140px 1fr;
          gap: 12px 24px;
        }
        .manual-body :global(.manual-glossary dt) {
          font-weight: 700;
          color: #0f172a;
          font-family: Georgia, serif;
          font-size: 15px;
        }
        .manual-body :global(.manual-glossary dd) {
          margin: 0;
          color: #475569;
        }

        /* Cierre */
        .manual-body :global(.manual-cierre) {
          margin-top: 60px !important;
        }
        .manual-body :global(.manual-cierre-rule) {
          height: 2px;
          background: #0f172a;
          margin-bottom: 20px;
        }
        .manual-body :global(.manual-cierre-text) {
          font-size: 16px;
          color: #334155;
        }
        .manual-body :global(.manual-sign) {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: #64748b;
          padding-top: 20px;
          margin-top: 20px;
          border-top: 1px solid #e2e8f0;
        }
      `}</style>
    </>
  );
}

/**
 * StepSection — cada uno de los 5 pasos con numero grande + icono + titulo.
 */
function StepSection({
  number,
  icon: Icon,
  title,
  children,
}: {
  number: number;
  icon: typeof Building2;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="manual-step-section">
      <div className="manual-step-header">
        <span className="manual-step-number">{number}</span>
        <Icon className="manual-step-icon" />
        <h2 className="manual-step-title">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-5 p-4 bg-sky-50 border-l-4 border-sky-500 rounded-r flex gap-3">
      <Lightbulb className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-sky-900 leading-relaxed m-0">
        <strong>Tip:</strong> {children}
      </p>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-5 p-4 bg-amber-50 border-l-4 border-amber-500 rounded-r flex gap-3">
      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-amber-900 leading-relaxed m-0">
        <strong>Nota:</strong> {children}
      </p>
    </div>
  );
}

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="my-4 pb-4 border-b border-slate-200 last:border-0 last:pb-0">
      <p className="font-semibold text-slate-900 mb-2">{q}</p>
      <div className="text-slate-700 text-[15px] leading-relaxed">{children}</div>
    </div>
  );
}

/**
 * ManualCover — portada solo-print del manual.
 */
function ManualCover() {
  return (
    <div className="print-only print-cover">
      <div>
        <div
          className="print-cover-brand-bar"
          style={{ background: "linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)" }}
        />
        <div className="print-cover-wordmark">
          <span className="print-cover-wordmark-a">A</span>
          <span className="print-cover-wordmark-text">AIBENCHEF</span>
        </div>
        <div className="print-cover-brand-sub">Plataforma de Analisis Financiero Regulado</div>
      </div>

      <div className="print-cover-hero">
        <div className="print-cover-hero-kicker">Manual del usuario</div>
        <h1 className="print-cover-hero-title">
          Informe
          <br />
          Benchmark
        </h1>
        <div className="print-cover-hero-rule" />
        <div className="print-cover-hero-cliente">Guia ejecutiva</div>
        <div className="print-cover-hero-periodo">
          5 minutos para dominar el analisis competitivo de tu entidad
        </div>
      </div>

      <div>
        <div className="print-cover-meta-table">
          <div className="print-cover-meta-cell">
            <div className="print-cover-meta-label">Audiencia</div>
            <div className="print-cover-meta-value">Gerente / CFO / Directorio</div>
          </div>
          <div className="print-cover-meta-cell">
            <div className="print-cover-meta-label">Tiempo de lectura</div>
            <div className="print-cover-meta-value">5 minutos</div>
          </div>
          <div className="print-cover-meta-cell">
            <div className="print-cover-meta-label">Actualizado</div>
            <div className="print-cover-meta-value">{GENERATED}</div>
          </div>
          <div className="print-cover-meta-cell">
            <div className="print-cover-meta-label">Version</div>
            <div className="print-cover-meta-value print-cover-meta-mono">v1.0</div>
          </div>
        </div>
      </div>

      <div className="print-cover-footer">
        <div className="print-cover-footer-rule" />
        <div className="print-cover-footer-grid">
          <div>
            <div className="print-cover-footer-label">Preparado por</div>
            <div className="print-cover-footer-value">Aibenchef</div>
          </div>
          <div>
            <div className="print-cover-footer-label">Cubre</div>
            <div className="print-cover-footer-value">Como abrir, interpretar y compartir el informe</div>
          </div>
          <div>
            <div className="print-cover-footer-label">Tipo</div>
            <div className="print-cover-footer-value" style={{ color: "#2563eb", fontWeight: 700 }}>MANUAL</div>
          </div>
        </div>
      </div>
    </div>
  );
}
