/**
 * Prompt template: "Benchmarking sectorial" — articulo long-form sobre
 * el ranking del cierre entre entidades comparables, quien lidera y por
 * que (descomposicion causal: rendimiento vs eficiencia vs provisiones).
 *
 * Contexto esperado en ctx.contexto:
 *   entidades: Array<{
 *     entidad: string;
 *     rendimiento: number;         // % (0-1)
 *     otros: number;               // % (0-1)
 *     gastoFinanciero: number;     // % (0-1) negativo natural
 *     costoProvision: number;      // % (0-1) negativo natural
 *     gastosOp: number;            // % (0-1) negativo natural
 *     margenAntesImpuestos: number;// % (0-1) natural
 *     puntoEquilibrio: number;     // % (0-1) natural
 *   }>
 */

import {
  PUBLICACION_SYSTEM_PROMPT,
  type PublicacionPromptTemplate,
} from "./base";
import type { PublicacionPromptContext } from "../types";

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

export const promptBenchmarkingSectorial: PublicacionPromptTemplate = {
  version: "v1",
  tema: "benchmarking_sectorial",
  hashtagsDefault: [
    "#SistemaFinancieroPeruano",
    "#Benchmarking",
    "#Microfinanzas",
    "#SBS",
    "#GestionFinanciera",
  ],
  build(ctx: PublicacionPromptContext): { system: string; user: string } {
    const entidades = (ctx.contexto.entidades ?? []) as PERow[];

    const sortedByMargen = [...entidades].sort(
      (a, b) => b.margenAntesImpuestos - a.margenAntesImpuestos,
    );
    const mejor = sortedByMargen[0];
    const peor = sortedByMargen[sortedByMargen.length - 1];
    const promMargen = entidades.length > 0
      ? entidades.reduce((s, e) => s + e.margenAntesImpuestos, 0) / entidades.length
      : 0;
    const promRend = entidades.length > 0
      ? entidades.reduce((s, e) => s + e.rendimiento, 0) / entidades.length
      : 0;
    const promGO = entidades.length > 0
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
        return `| ${e.entidad.padEnd(28)} | ${fmt(e.rendimiento).padStart(6)}% | ${fmtSigned(e.otros).padStart(7)}% | ${fmtSigned(e.gastoFinanciero).padStart(7)}% | ${fmtSigned(e.costoProvision).padStart(7)}% | ${fmtSigned(e.gastosOp).padStart(7)}% | ${fmtSigned(e.margenAntesImpuestos).padStart(7)}% | ${fmtSigned(e.puntoEquilibrio).padStart(7)}% |${marca}`;
      })
      .join("\n");

    const user = `# ARTICULO: Benchmarking sectorial — Cierre ${ctx.periodoLabel}

## Contexto del articulo
Cliente objetivo (entidad propia): ${ctx.entidadPropia}
Grupo comparable (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}

## Data del cierre (% sobre cartera promedio TTM)
| Entidad                       | Rendim | Otros   | GastoFin| Provis  | GastosOp| Margen  | PtoEqu  |
|-------------------------------|--------|---------|---------|---------|---------|---------|---------|
${tabla}

Referencia del grupo:
- Margen promedio: ${fmt(promMargen)}%
- Rendimiento promedio: ${fmt(promRend)}%
- Gastos Operacionales promedio: ${fmt(promGO)}%
- Lider en margen: ${mejor?.entidad ?? "—"} (${mejor ? fmt(mejor.margenAntesImpuestos) : "0.00"}%)
- Mas rezagado: ${peor?.entidad ?? "—"} (${peor ? fmt(peor.margenAntesImpuestos) : "0.00"}%)

## GLOSARIO CRITICO:
- **Margen antes de Impuestos = Rendimiento + PE** (identidad matematica).
- **PE (Punto de Equilibrio)**: suma con signo natural de Otros + Gasto Financiero + Costo Provision + Gastos Operacionales. Casi siempre NEGATIVO (costos superan a Otros); cuanto MENOS NEGATIVO, mejor.
- **Microfinancieras** (CMAC/CRAC/EDPYME con Rendimiento >18%): naturaleza de GO altos por modelo de campo. NO es sinonimo de ineficiencia.
- **Bancos comerciales** (Rendimiento 6-12%): otra escala operativa.

## INSTRUCCIONES ESPECIFICAS PARA ESTE ARTICULO:

ESTRUCTURA sugerida (adapta si el data lo permite):
- **Titulo**: menciona el segmento y el cierre. Ej: "Cajas municipales al cierre ${ctx.periodoLabel}: quien lidera el margen y como lo consigue"
- **Apertura** (1-2 parrafos): la observacion mas llamativa del ranking. Puede arrancar con la brecha entre lider y ultimo, o con una pregunta contraintuitiva.
- **Seccion 1 — 📊 El ranking**: presenta las cifras principales del grupo. Menciona TODAS las entidades. Ubica a la entidad propia en el ranking.
- **Seccion 2 — 💡 Que explica la diferencia**: descompone la causa. ¿Lider por rendimiento alto o por PE contenido? Compara componentes.
- **Seccion 3 — ⚠️ Riesgos y presiones**: donde el grupo esta expuesto (costo fondeo si subieran tasas, provisiones si sube CAR, gastos op si presion salarial).
- **Cierre**: sintesis + call-to-action o pregunta retadora para la entidad propia. Estilo Ferreyra: "¿Puede ${ctx.entidadPropia} sostener este ritmo si...?"

Recuerda: prosa continua, cero bullets, subtitulos con emoji + titulo (##), bold moderado en cifras clave.

Output: JSON exacto con {titulo, contenidoMd, hashtags} — nada mas.`;

    return { system: PUBLICACION_SYSTEM_PROMPT, user };
  },
};
