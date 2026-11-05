/**
 * Prompt template para "Doctor Financiero — Punto de Equilibrio" v3.
 *
 * Enfoque: analista que EXAMINA y PRESCRIBE, no solo compara.
 * Cada analisis tiene 3 capas:
 *   1. DIAGNÓSTICO — que le pasa a la entidad propia (cifras exactas)
 *   2. CAUSA RAÍZ  — por que ocurre (descomposicion de componentes)
 *   3. PRESCRIPCIÓN — que debe hacer (accionable, especifico, priorizado)
 *
 * v3 incorpora tendencia historica de la entidad propia (hasta 4 cierres
 * anteriores) para diagnosticar si esta mejorando o deteriorando — no solo
 * donde esta hoy.
 *
 * Contexto esperado en ctx.contexto:
 *   entidades: Array<{
 *     entidad: string;
 *     rendimiento: number;          // % (0-1)
 *     otros: number;                // % (0-1) — puede ser (+) o (-)
 *     gastoFinanciero: number;      // % (0-1) — negativo natural
 *     costoProvision: number;       // % (0-1) — negativo natural
 *     gastosOp: number;             // % (0-1) — negativo natural
 *     margenAntesImpuestos: number; // % (0-1)
 *     puntoEquilibrio: number;      // % (0-1) — valor absoluto (carga total)
 *   }>
 *   tendenciaPropia: Array<{
 *     periodoLabel: string;         // eg. "Dic 2023"
 *     rendimiento: number;
 *     gastoFinanciero: number;
 *     costoProvision: number;
 *     gastosOp: number;
 *     margen: number;
 *     puntoEquilibrio: number;
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

type TendenciaPunto = {
  periodoLabel: string;
  rendimiento: number;
  gastoFinanciero: number;
  costoProvision: number;
  gastosOp: number;
  margen: number;
  puntoEquilibrio: number;
};

export const promptPuntoEquilibrio: PromptTemplate = {
  version: "v3",
  seccion: "punto_equilibrio",
  build(ctx: PromptContext): { system: string; user: string } {
    const entidades = (ctx.contexto.entidades ?? []) as PERow[];
    const tendenciaPropia = (ctx.contexto.tendenciaPropia ?? []) as TendenciaPunto[];

    const sortedByMargen = [...entidades].sort(
      (a, b) => b.margenAntesImpuestos - a.margenAntesImpuestos,
    );
    const mejor = sortedByMargen[0];
    const peor = sortedByMargen[sortedByMargen.length - 1];
    const propiaRow = entidades.find((e) => e.entidad === ctx.entidadPropia);

    const promMargen =
      entidades.length > 0
        ? entidades.reduce((s, e) => s + e.margenAntesImpuestos, 0) / entidades.length
        : 0;
    const promRend =
      entidades.length > 0
        ? entidades.reduce((s, e) => s + e.rendimiento, 0) / entidades.length
        : 0;
    const promGO =
      entidades.length > 0
        ? entidades.reduce((s, e) => s + e.gastosOp, 0) / entidades.length
        : 0;

    const fmt = (v: number) => (v * 100).toFixed(2);
    const fmtSigned = (v: number) => {
      const s = (v * 100).toFixed(2);
      return v >= 0 ? `+${s}` : s;
    };

    const tabla = entidades
      .map((e) => {
        const marca = e.entidad === ctx.entidadPropia ? " ← ENTIDAD PROPIA" : "";
        return (
          `| ${e.entidad.padEnd(28)} | ${fmt(e.rendimiento).padStart(6)}% | ${fmtSigned(e.otros).padStart(7)}% | ${fmtSigned(e.gastoFinanciero).padStart(7)}% | ${fmtSigned(e.costoProvision).padStart(7)}% | ${fmtSigned(e.gastosOp).padStart(7)}% | ${fmtSigned(e.margenAntesImpuestos).padStart(7)}% | ${fmt(e.puntoEquilibrio).padStart(6)}% |${marca}`
        );
      })
      .join("\n");

    // Tabla de tendencia historica de la entidad propia
    const tablaTendencia =
      tendenciaPropia.length > 0
        ? tendenciaPropia
            .map(
              (p) =>
                `| ${p.periodoLabel.padEnd(12)} | ${fmt(p.rendimiento).padStart(6)}% | ${fmtSigned(p.gastoFinanciero).padStart(7)}% | ${fmtSigned(p.costoProvision).padStart(7)}% | ${fmtSigned(p.gastosOp).padStart(7)}% | ${fmtSigned(p.margen).padStart(7)}% | ${fmt(p.puntoEquilibrio).padStart(6)}% |`,
            )
            .join("\n")
        : null;

    // Calculo de tendencia de margen para diagnostic summary
    let tendenciaDiag = "";
    if (tendenciaPropia.length >= 2) {
      const primero = tendenciaPropia[0];
      const ultimo = tendenciaPropia[tendenciaPropia.length - 1];
      const deltaMargen = ((ultimo.margen - primero.margen) * 100).toFixed(2);
      const deltaRend = ((ultimo.rendimiento - primero.rendimiento) * 100).toFixed(2);
      const deltaGO = ((ultimo.gastosOp - primero.gastosOp) * 100).toFixed(2);
      const signo = (n: string) => (parseFloat(n) >= 0 ? `+${n}` : n);
      tendenciaDiag = `Desde ${primero.periodoLabel} hasta ${ultimo.periodoLabel}: Margen ${signo(deltaMargen)} pp | Rendimiento ${signo(deltaRend)} pp | Gastos Op ${signo(deltaGO)} pp`;
    }

    const posicionPropia = propiaRow
      ? sortedByMargen.findIndex((e) => e.entidad === ctx.entidadPropia) + 1
      : null;

    const user = `# Diagnóstico Punto de Equilibrio — Cierre ${ctx.periodoLabel}

ENTIDAD PROPIA (paciente): ${ctx.entidadPropia}
Grupo de referencia (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}
${posicionPropia != null ? `Posicion en ranking de margen: #${posicionPropia} de ${entidades.length}` : ""}

## CUADRO COMPARATIVO — Descomposicion del Margen antes de Impuestos (% sobre cartera TTM)
| Entidad                       | Rendim | Otros   | GastoFin| Provis  | GastosOp| Margen  | PE(carga)|
|-------------------------------|--------|---------|---------|---------|---------|---------|----------|
${tabla}

Referencia del grupo:
- Margen promedio: ${fmt(promMargen)}%
- Rendimiento promedio: ${fmt(promRend)}%
- Gastos Operacionales promedio: ${fmt(promGO)}%
- Lider en margen: ${mejor?.entidad ?? "—"} (${mejor ? fmt(mejor.margenAntesImpuestos) : "0.00"}%)
- Mas rezagado: ${peor?.entidad ?? "—"} (${peor ? fmt(peor.margenAntesImpuestos) : "0.00"}%)

${
  tablaTendencia
    ? `## TENDENCIA HISTÓRICA — ${ctx.entidadPropia} (ultimos ${tendenciaPropia.length} cierres)
| Periodo      | Rendim | GastoFin| Provis  | GastosOp| Margen  | PE(carga)|
|--------------|--------|---------|---------|---------|---------|----------|
${tablaTendencia}
${tendenciaDiag ? `\nResumen de movimiento: ${tendenciaDiag}` : ""}
`
    : ""
}
## GLOSARIO CRITICO:
- **Punto de Equilibrio (PE/carga)**: valor absoluto de (Otros + Gasto Fin + Provision + Gastos Op). Representa cuanto rendimiento de cartera necesita la entidad para cubrir todos sus costos. Menor PE = estructura de costos mas liviana.
- **Margen = Rendimiento − PE(carga)**. Si el rendimiento supera la carga total, hay margen positivo.
- **Tendencia del margen**: si mejora, la entidad esta saneando su estructura. Si empeora, hay presion creciente.

## INSTRUCCIONES — DIAGNÓSTICO COMO DOCTOR FINANCIERO:

Eres el doctor financiero de ${ctx.entidadPropia}. Tu trabajo es examinar los sintomas, dar el diagnostico y prescribir el tratamiento.

ESTRUCTURA DE BULLETS — cada bullet responde a un "cuadro clinico":

**Bullet 1 — DIAGNÓSTICO GENERAL de la entidad propia:**
Donde esta en el ranking, cual es el margen hoy, y si la tendencia historica muestra mejora o deterioro. Usa los datos de la tabla de tendencia para decir si el "paciente" esta recuperandose o agravandose. Cierra con **Diagnostico:** [estado de salud: estable/en recuperacion/en deterioro].

**Bullet 2 — COMPONENTE CRITICO (el mayor "dolor" o fortaleza):**
Identifica cual componente del PE es el mas pesado PARA LA ENTIDAD PROPIA (Gastos Op, Gasto Fin, o Provision) y si esta mejorando o empeorando vs cierres anteriores. Compara con el promedio del grupo. Cierra con **Prescripcion:** [accion especifica sobre ese componente].

**Bullet 3 — LIDER DEL GRUPO (el "paciente mas sano"):**
Quien lidera, por que gana — ¿rendimiento mas alto, gastos Op mas bajos, o mejor gestion de provision? Extrae la leccion que la entidad propia puede aplicar. Cierra con **Oportunidad:** [que puede copiar/adaptar].

**Bullet 4 — REZAGADO DEL GRUPO (caso de alarma):**
Quien esta en la peor posicion, cual es el driver del problema. Si la entidad propia tiene ese mismo sintoma aunque en menor grado, alertarlo. Cierra con **Riesgo:** [que debe vigilar para no caer en ese patron].

**Bullet 5 — COMPARACION CRUZADA (dos dinamicas contrastantes):**
Dos pares de entidades del grupo con patrones distintos — una que gana por rendimiento, otra por eficiencia. Menciona a TODAS las entidades que aun no hayas nombrado. Cierra con **Implica:** [dinamica estructural del grupo].

**Bullet 6 — PRESCRIPCIÓN INTEGRAL (cierre ejecutivo):**
Tres prioridades concretas para la entidad propia, en orden de impacto. Usa la estructura "1) ... 2) ... 3) ...". Cierra con una pregunta retadora o prediccion cuantitativa con horizonte temporal. Cierra con **Accion:** [resumen ejecutivo de las 3 prioridades].

REGLAS CLINICAS:
- Solo cifras EXACTAS de las tablas — prohibido inventar, estimar, extrapolar.
- Si la tendencia muestra deterioro, NO suavices el diagnostico. Si muestra mejora, reconocela con precision.
- Menciona TODAS las entidades del grupo en algun bullet.
- Castellano peruano (tu/tienes/puedes/estas). Sin voseo argentino.
- Preserva siempre la letra ñ: campaña, año, señal, diseño, compañia, pequeña.
- Emojis: max 1 por bullet. 🩺 diagnostico grave | ⚡ punto de inflexion | 🎯 oportunidad | ⚠️ riesgo | 🔥 logro notable.
- NO digas "cuadrante", "peer group", "mediana", "outlier", "delta", "YoY" sin explicar.

Output: JSON array de 6 bullets. Nada mas — sin markdown fences, sin comentarios previos.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
