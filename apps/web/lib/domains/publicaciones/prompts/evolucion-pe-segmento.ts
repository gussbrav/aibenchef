/**
 * Prompt template: "Evolucion PE por segmento" — articulo long-form
 * educativo sobre como el Punto de Equilibrio ha evolucionado en los
 * ultimos 5 cierres para el segmento (bancos vs microfinanzas), con
 * enfoque en tendencias estructurales y compresion/expansion de margenes.
 *
 * Contexto esperado en ctx.contexto:
 *   serie: Array<{
 *     entidad: string;
 *     evolucion: Array<{
 *       periodo: number;              // YYYYMM
 *       periodoLabel: string;         // "Jun 2026"
 *       rendimiento: number;          // 0-1
 *       puntoEquilibrio: number;      // 0-1 natural
 *       margenAntesImpuestos: number; // 0-1
 *     }>
 *   }>
 */

import {
  PUBLICACION_SYSTEM_PROMPT,
  type PublicacionPromptTemplate,
} from "./base";
import type { PublicacionPromptContext } from "../types";

type EvolucionSerie = {
  entidad: string;
  evolucion: Array<{
    periodo: number;
    periodoLabel: string;
    rendimiento: number;
    puntoEquilibrio: number;
    margenAntesImpuestos: number;
  }>;
};

export const promptEvolucionPeSegmento: PublicacionPromptTemplate = {
  version: "v1",
  tema: "evolucion_pe_segmento",
  hashtagsDefault: [
    "#PuntoDeEquilibrio",
    "#SistemaFinancieroPeruano",
    "#Microfinanzas",
    "#GestionFinanciera",
    "#SBS",
  ],
  build(ctx: PublicacionPromptContext): { system: string; user: string } {
    const series = (ctx.contexto.serie ?? []) as EvolucionSerie[];

    const fmt = (v: number) => (v * 100).toFixed(2);
    const fmtSigned = (v: number) => {
      const s = (v * 100).toFixed(2);
      return v >= 0 ? `+${s}` : s;
    };

    // Tabla de evolucion: filas = periodos, columnas = entidades para margen
    const periodosUnicos = Array.from(
      new Set(series.flatMap((s) => s.evolucion.map((p) => p.periodo))),
    ).sort((a, b) => a - b);

    const evolucionMargen = periodosUnicos
      .map((p) => {
        const label = series[0]?.evolucion.find((e) => e.periodo === p)?.periodoLabel ?? String(p);
        const cells = series.map((s) => {
          const punto = s.evolucion.find((e) => e.periodo === p);
          return punto ? fmtSigned(punto.margenAntesImpuestos).padStart(7) + "%" : "     —";
        });
        return `| ${label.padEnd(10)} | ${cells.join(" | ")} |`;
      })
      .join("\n");

    const headerMargen = `| Periodo    | ${series.map((s) => s.entidad.padEnd(15).slice(0, 15)).join(" | ")} |`;
    const separadorMargen = `|------------|${series.map(() => "-----------------").join("|")}|`;

    // Tabla evolucion PE (mas denso)
    const evolucionPE = periodosUnicos
      .map((p) => {
        const label = series[0]?.evolucion.find((e) => e.periodo === p)?.periodoLabel ?? String(p);
        const cells = series.map((s) => {
          const punto = s.evolucion.find((e) => e.periodo === p);
          return punto ? fmtSigned(punto.puntoEquilibrio).padStart(7) + "%" : "     —";
        });
        return `| ${label.padEnd(10)} | ${cells.join(" | ")} |`;
      })
      .join("\n");

    const user = `# ARTICULO: Evolucion del Punto de Equilibrio por segmento — Ultimos ${periodosUnicos.length} cierres

## Contexto del articulo
Cliente objetivo: ${ctx.entidadPropia}
Grupo comparable (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}
Cierre mas reciente: ${ctx.periodoLabel}

## Evolucion del Margen antes de Impuestos (% sobre cartera promedio TTM)
${headerMargen}
${separadorMargen}
${evolucionMargen}

## Evolucion del PE (Punto de Equilibrio, negativo natural — cuanto MENOS NEGATIVO, mejor)
${headerMargen}
${separadorMargen}
${evolucionPE}

## GLOSARIO CRITICO:
- **PE = Otros + Gasto Financiero + Costo Provision + Gastos Operacionales** (signo natural, casi siempre negativo).
- **Margen antes de Impuestos = Rendimiento + PE**. Si el PE se hace MENOS NEGATIVO en el tiempo, el grupo mejora eficiencia. Si se hace MAS NEGATIVO, el grupo esta bajo presion de costos.
- **Compresion de margen**: cuando el margen cae aunque el rendimiento se mantenga — la causa es que el PE se hace mas negativo (costos suben mas rapido que ingresos).
- **Expansion de margen**: al reves — PE mejora (menos negativo) sin caida de rendimiento.
- **Bancos comerciales** vs **microfinancieras**: distintas magnitudes de PE por naturaleza del modelo (microfinanzas requieren mas GO por gestion de campo).

## INSTRUCCIONES ESPECIFICAS PARA ESTE ARTICULO:

ANGULO EDITORIAL: contar la HISTORIA de la evolucion. El lector no quiere una tabla de numeros — quiere entender que paso en el segmento en los ultimos ${periodosUnicos.length} cierres, quien mejoro y por que, quien empeoro y por que.

ESTRUCTURA sugerida:
- **Titulo**: enfoque en la tendencia dominante. Ej: "5 cierres despues: ¿como evoluciono el margen de las cajas municipales?"
- **Apertura**: la observacion mas llamativa de la serie temporal (ej: "en 5 cierres, el margen de X paso de Y% a Z%").
- **Seccion 1 — 📊 La foto de arranque vs la foto actual**: comparar el primer y ultimo cierre para las entidades del grupo.
- **Seccion 2 — 💡 Quien mejoro y por que**: identificar la(s) entidad(es) que mostraron expansion de margen y descomponer si vino por rendimiento o por eficiencia.
- **Seccion 3 — ⚠️ Quien esta bajo presion**: identificar compresion de margen y sus causas.
- **Cierre**: proyeccion o pregunta retadora. Ej: "Si la tendencia se mantiene, ¿donde estara ${ctx.entidadPropia} en 3 cierres mas?"

REGLAS DURAS:
- Menciona TODAS las entidades del grupo al menos una vez.
- Usa las cifras EXACTAS de la tabla de evolucion — cero invencion.
- Cuando hables de "los ultimos ${periodosUnicos.length} cierres", refiere al rango real (${series[0]?.evolucion[0]?.periodoLabel ?? "—"} a ${ctx.periodoLabel}).
- Prosa continua, cero bullets, subtitulos con emoji + titulo (##), bold moderado en cifras clave.

Output: JSON exacto con {titulo, contenidoMd, hashtags} — nada mas.`;

    return { system: PUBLICACION_SYSTEM_PROMPT, user };
  },
};
