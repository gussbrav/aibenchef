import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText, GitBranch, ShieldCheck } from "lucide-react";

import { Container } from "@/components/ui";

export const metadata: Metadata = {
  title: "Fuentes y metodología · Aibenchef",
  description:
    "De dónde provienen los datos de Aibenchef y qué transformaciones aplicamos. Fuente primaria: reportes públicos SBS.",
};

export default function FuentesMetodologiaPage() {
  return (
    <main className="min-h-screen bg-white py-12">
      <Container size="md">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900 mb-8"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver al inicio
        </Link>

        <header className="space-y-3 mb-10">
          <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">
            Documentación
          </p>
          <h1 className="text-4xl font-bold text-slate-900 tracking-tight">
            Fuentes y metodología
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed">
            De dónde provienen los datos que aparecen en Aibenchef y qué
            transformaciones aplicamos antes de mostrarlos.
          </p>
        </header>

        <div className="space-y-10 text-slate-700">
          {/* ============ Fuente primaria ============ */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-5 h-5 text-slate-500" />
              <h2 className="text-xl font-bold text-slate-900">Fuente primaria</h2>
            </div>
            <p className="leading-relaxed">
              La información base proviene de reportes públicos publicados por
              la <strong>Superintendencia de Banca, Seguros y AFP del Perú (SBS)</strong>,
              al amparo de la <strong>Ley N° 26702</strong> (Ley General del
              Sistema Financiero y del Sistema de Seguros y Orgánica de la SBS)
              y las normas de transparencia que obligan a la publicación
              periódica de indicadores del sistema financiero peruano.
            </p>
            <p className="mt-3 leading-relaxed">
              Ingerimos los archivos oficiales publicados en el portal SBS
              (típicamente formato Excel .xls) para los siguientes tópicos:
            </p>
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 text-sm">
              <li>• Estados Financieros (Balance + ER)</li>
              <li>• Indicadores prudenciales</li>
              <li>• Colocaciones (por tipo y sector)</li>
              <li>• Depósitos</li>
              <li>• Cartera atrasada + castigos</li>
              <li>• Créditos y depósitos por oficina/geografía</li>
              <li>• Clientes de crédito y ahorro</li>
              <li>• Personal y oficinas</li>
              <li>• Tasas activas y pasivas</li>
            </ul>
            <p className="mt-3 leading-relaxed">
              Cobertura: bancos, financieras, cajas municipales (CMAC), cajas
              rurales (CRAC) y edpymes. Serie histórica desde 2010 hasta el
              cierre mensual más reciente que la SBS haya publicado.
            </p>
          </section>

          {/* ============ Transformaciones ============ */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <GitBranch className="w-5 h-5 text-slate-500" />
              <h2 className="text-xl font-bold text-slate-900">
                Transformaciones aplicadas
              </h2>
            </div>
            <p className="leading-relaxed">
              Los datos crudos de SBS pasan por una capa de procesamiento
              propia antes de mostrarse en el producto. Los pasos principales:
            </p>
            <ol className="mt-4 space-y-3 list-decimal list-inside text-sm leading-relaxed">
              <li>
                <strong>Ingesta y validación estructural</strong>: parseamos
                los archivos Excel con validación de esquema, detectamos
                cambios de cabeceras y archivos truncados o incompletos.
              </li>
              <li>
                <strong>Canonización de entidades</strong>: SBS publica el
                mismo entidad con distintas variantes de nombre (mayúsculas,
                truncados, rebrandings). Mantenemos una tabla maestra que
                unifica todos los alias históricos a un nombre canónico único
                por entidad conceptual.
              </li>
              <li>
                <strong>Reglas de negocio y ratios derivados</strong>: sobre
                los datos base calculamos indicadores adicionales (ROA, ROE,
                mora, cobertura CAR, punto de equilibrio, DuPont, márgenes
                netos, apalancamiento, entre otros) siguiendo definiciones
                estándar de análisis financiero peruano.
              </li>
              <li>
                <strong>Materialización y agregación</strong>: pre-calculamos
                vistas materializadas para peer group y análisis temporal, con
                refresh automático cuando llega data nueva.
              </li>
              <li>
                <strong>Conciliación contra SBS</strong>: cuando la SBS
                publica ratios oficiales (ROA, ROE, mora criterio SBS), los
                comparamos automáticamente contra nuestro cálculo para
                detectar drift de metodología. Objetivo: mantener nuestros
                indicadores dentro de ±5 puntos base del valor oficial.
              </li>
            </ol>
          </section>

          {/* ============ Frecuencia y latencia ============ */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">
              Frecuencia y latencia de actualización
            </h2>
            <p className="leading-relaxed text-sm">
              La SBS publica los Estados Financieros aproximadamente 30 días
              después del cierre mensual. Los reportes secundarios
              (indicadores prudenciales, castigos, tasas) pueden tardar entre
              2 y 4 semanas adicionales. Nuestro sistema descarga
              automáticamente los archivos nuevos, aplica las transformaciones
              y actualiza los dashboards dentro de las 24 horas siguientes a
              la publicación oficial.
            </p>
          </section>

          {/* ============ Disclaimer legal ============ */}
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="w-5 h-5 text-slate-500" />
              <h2 className="text-xl font-bold text-slate-900">Disclaimer</h2>
            </div>
            <div className="space-y-3 text-sm leading-relaxed">
              <p>
                <strong>Aibenchef es un servicio independiente</strong> de
                análisis y consultoría financiera especializada en el sistema
                financiero peruano. No representamos, no estamos afiliados y
                no somos endosados por la Superintendencia de Banca, Seguros
                y AFP del Perú (SBS) ni por ninguna de las entidades
                financieras cuyos indicadores mostramos.
              </p>
              <p>
                La información publicada por SBS es de acceso público. El
                valor que Aibenchef ofrece consiste en la capa analítica,
                metodológica y de visualización aplicada sobre esa
                información, así como el trabajo de consultoría de nuestro
                equipo profesional.
              </p>
              <p>
                Aunque aplicamos controles de calidad automatizados y
                conciliación contra los valores oficiales publicados, las
                cifras derivadas pueden diferir marginalmente por diferencias
                metodológicas legítimas (ventanas de promedio, criterios de
                consolidación, redondeos). En caso de discrepancia entre
                nuestro cálculo y el valor oficial SBS, prevalece la
                publicación oficial de SBS.
              </p>
              <p>
                Los análisis, comparativas y recomendaciones que ofrecemos
                son informativos y no constituyen asesoría de inversión ni
                recomendación de operaciones financieras específicas.
              </p>
            </div>
          </section>

          {/* ============ Contacto ============ */}
          <section className="text-center text-sm text-slate-500 pt-6 border-t border-slate-200">
            <p>
              ¿Detectaste una inconsistencia en algún dato o tienes preguntas
              sobre la metodología?{" "}
              <a
                href="mailto:hola@aibenchef.com"
                className="text-brand-600 hover:underline font-medium"
              >
                Escríbenos
              </a>
              .
            </p>
          </section>
        </div>
      </Container>
    </main>
  );
}
