/**
 * Prompt template para "Analisis del Punto de Equilibrio" — cuadro
 * comparativo por entidad en modo cierre unico.
 *
 * Estilo: inspirado en los posts de LinkedIn de Jesus Ferreyra
 * (Aprendiz de Microfinanzas / Gerente Central de Negocios). Combina
 * la rigurosidad SBS del SYSTEM_PROMPT_BASE con:
 *   - Observaciones punchy que llaman la atencion
 *   - Comparaciones directas entre entidades ("X vs Y")
 *   - Emojis con proposito (🔥 logro notable, ⚠️ riesgo, 🎯 oportunidad)
 *   - Preguntas abiertas o predicciones al cierre (engagement)
 *   - Reconocer merito cuando aplica ("meritorio", "modesto", "muy lejos")
 *
 * Contexto esperado en ctx.contexto:
 *   entidades: Array<{
 *     entidad: string;             // nombre canonico
 *     rendimiento: number;         // % (0-1)
 *     otros: number;               // % (0-1) — puede ser (+) o (-)
 *     gastoFinanciero: number;     // % (0-1) — negativo natural
 *     costoProvision: number;      // % (0-1) — negativo natural
 *     gastosOp: number;            // % (0-1) — negativo natural
 *     margenAntesImpuestos: number;// % (0-1) — natural (Rend + suma)
 *     puntoEquilibrio: number;     // % (0-1) — natural (Otros + GF + Prov + GO)
 *   }>
 */

import { SYSTEM_PROMPT_BASE, type PromptTemplate } from "./base";
import type { PromptContext } from "../types";

type PERow = {
  entidad: string;
  rendimiento: number;
  otros: number;
  gastoFinanciero: number;
  costoProvision: number;
  gastosOp: number;
  margenAntesImpuestos: number;
  puntoEquilibrio: number;
};

export const promptPuntoEquilibrio: PromptTemplate = {
  version: "v1",
  seccion: "punto_equilibrio",
  build(ctx: PromptContext): { system: string; user: string } {
    const entidades = (ctx.contexto.entidades ?? []) as PERow[];

    // Ranking del grupo por Margen antes de Impuestos — para identificar
    // "el mejor" y "el mas rezagado" que el analisis debe comentar.
    const sortedByMargen = [...entidades].sort(
      (a, b) => b.margenAntesImpuestos - a.margenAntesImpuestos,
    );
    const mejor = sortedByMargen[0];
    const peor = sortedByMargen[sortedByMargen.length - 1];

    // Promedio del grupo — referencia para decir "muy por encima" / "por debajo"
    const promMargen = entidades.length > 0
      ? entidades.reduce((s, e) => s + e.margenAntesImpuestos, 0) / entidades.length
      : 0;
    const promRend = entidades.length > 0
      ? entidades.reduce((s, e) => s + e.rendimiento, 0) / entidades.length
      : 0;
    const promGO = entidades.length > 0
      ? entidades.reduce((s, e) => s + e.gastosOp, 0) / entidades.length
      : 0;

    // Tabla legible: alineada monoespacio para que el LLM lea fila-por-fila
    // sin confundirse. Signos EXPLICITOS (+/-) en todas las columnas de PE
    // asi el LLM no invierte signos.
    const fmt = (v: number) => (v * 100).toFixed(2);
    const fmtSigned = (v: number) => {
      const s = (v * 100).toFixed(2);
      return v >= 0 ? `+${s}` : s;
    };

    const tabla = entidades
      .map((e) => {
        const marca = e.entidad === ctx.entidadPropia ? " ← ENTIDAD PROPIA" : "";
        return `| ${e.entidad.padEnd(28)} | ${fmt(e.rendimiento).padStart(6)}% | ${fmtSigned(e.otros).padStart(7)}% | ${fmtSigned(e.gastoFinanciero).padStart(7)}% | ${fmtSigned(e.costoProvision).padStart(7)}% | ${fmtSigned(e.gastosOp).padStart(7)}% | ${fmtSigned(e.margenAntesImpuestos).padStart(7)}% | ${fmtSigned(e.puntoEquilibrio).padStart(7)}% |${marca}`;
      })
      .join("\n");

    const user = `# Analisis Punto de Equilibrio — Cierre ${ctx.periodoLabel}

Cliente objetivo (ENTIDAD PROPIA): ${ctx.entidadPropia}
Grupo comparable (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}

## Cuadro comparativo — Descomposicion del Margen antes de Impuestos (% sobre cartera promedio TTM)
| Entidad                       | Rendim | Otros   | GastoFin| Provis  | GastosOp| Margen  | PtoEqu  |
|-------------------------------|--------|---------|---------|---------|---------|---------|---------|
${tabla}

Referencia del grupo:
- Margen promedio: ${fmt(promMargen)}%
- Rendimiento promedio: ${fmt(promRend)}%
- Gastos Operacionales promedio: ${fmt(promGO)}%
- Lider en margen: ${mejor?.entidad ?? "—"} (${mejor ? fmt(mejor.margenAntesImpuestos) : "0.00"}%)
- Mas rezagado: ${peor?.entidad ?? "—"} (${peor ? fmt(peor.margenAntesImpuestos) : "0.00"}%)

## GLOSARIO CRITICO (usalo EXACTAMENTE asi):
- **Punto de Equilibrio (PE)**: suma con signo natural de Otros + Gasto Financiero + Costo Provision + Gastos Operacionales. Es la CONTRIBUCION NETA de los componentes no-rendimiento al margen. En este cuadro es NEGATIVO para todas las entidades (los costos superan a Otros Ingresos). Cuanto MENOS NEGATIVO, mejor.
- **Margen antes de Impuestos = Rendimiento + PE**. Si Rendimiento (+) es mayor que |PE|, la entidad genera margen positivo.
- **Rendimiento de cartera**: cta 1.4 SBS (intereses de creditos directos) sobre cartera promedio. Es el motor de ingresos core.
- **Gastos Operacionales altos** en microfinanzas son la naturaleza del negocio (agentes, agencias, gestion de mora); NO son sinonimo de ineficiencia sin comparar con la mediana del grupo.

## INSTRUCCIONES ESPECIFICAS DE ESTA SECCION (estilo del analisis):

TONO Y VOZ — inspirado en observadores expertos del sector microfinanzas peruano tipo Jesus Ferreyra (LinkedIn: "Aprendiz de Microfinanzas"):
- ARRANCA con la observacion mas llamativa del cierre — no con "El grupo comparativo muestra...". Ejemplo: "CMAC Cusco lidera el margen con 5.60% — 2.29 pp por encima de CMAC Arequipa."
- Usa comparaciones DIRECTAS entre 2 entidades ("X vs Y", "muy por encima de Z", "muy lejos del alcance de W").
- Reconoce el MERITO con adjetivos precisos ("meritorio", "modesto", "sobresaliente") cuando el numero lo justifica — nunca vacio.
- Descompone la CAUSA: si el margen de X es alto, ¿es por rendimiento mayor o por gastos operacionales menores? Sacalo de la tabla.
- Cierra los bullets prescriptivamente con **Implica:**, **Accion:**, **Riesgo:** u **Oportunidad:** (regla dura de la clasificadora — no negociable).
- Usa emojis con proposito y moderacion (1 emoji por bullet MAX, solo si aporta): 🔥 logro notable, ⚠️ riesgo latente, 🎯 oportunidad clara, 📊 comparativo. NUNCA en el bullet de la entidad propia si el numero es negativo.
- El ULTIMO bullet cierra con una PREGUNTA ABIERTA o PREDICCION cuantitativa que invite a la reflexion: "¿Puede X sostener este margen si sube 50 bps el fondeo?" o "Si el ritmo se mantiene, en 3 cierres CMAC Cusco superara a CMAC Maynas en margen".

CONTENIDO POR BULLET:
- Bullet 1: **ENTIDAD PROPIA** — donde esta en el ranking, que motor la explica (rendimiento alto? PE contenido?), que hacer.
- Bullet 2: **Lider del grupo** — quien es, por que gana (rendimiento vs eficiencia), que puede aprender la entidad propia.
- Bullet 3: **Rezagado del grupo** — quien queda ultimo, cual es el driver (rendimiento bajo o costos altos), riesgo.
- Bullet 4-5: **Comparaciones cruzadas** — dos pares de entidades con dinamicas contrastantes ("X gana por rendimiento, Y gana por eficiencia"). Menciona TODAS las entidades del grupo aunque sea de forma breve.
- Bullet 6 (cierre): **Lectura transversal del grupo** con pregunta abierta o prediccion cuantitativa.

REGLAS DURAS:
- Solo cifras EXACTAS de la tabla — cero invencion.
- Signos correctos: PE y componentes de costo son NEGATIVOS naturales; el numero ya viene con signo, respetalo.
- No digas "cuadrante" ni "peer group" ni "mediana" (rompe el vocabulario obligatorio del sistema).
- Menciona TODAS las entidades del grupo. Ninguna queda afuera.
- Distingue: microfinancieras (CMAC/CRAC/EDPYME/Financiera con Rendimiento >18%) tienen naturaleza de Gastos Operacionales altos por el modelo de campo; bancos comerciales (Rendimiento 6-12%) operan otra escala.

Output: JSON array de 5-7 bullets. Nada mas — sin markdown fences, sin comentarios previos.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
