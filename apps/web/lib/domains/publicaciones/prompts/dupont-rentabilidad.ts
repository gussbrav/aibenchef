/**
 * Prompt template: "DuPont / Rentabilidad patrimonial" — articulo que
 * explica el ROE del grupo descomponiendo con la formula DuPont
 * (ROE = MON + Otros + Impuestos; MON = MFB + ISFN - Personal - Generales - Provisiones).
 *
 * Contexto esperado en ctx.contexto:
 *   entidades: Array<{
 *     entidad: string;
 *     roe: number;              // % (0-1) anualizado TTM
 *     roa: number;              // % (0-1)
 *     apalancamiento: number;   // Activo/Patrimonio (multiplo)
 *     mon: number;              // Margen Operacional Neto (0-1)
 *     mfb: number;              // Margen Financiero Bruto (0-1)
 *     isfn: number;             // Ingresos por Servicios Financieros Netos (0-1)
 *     provisiones: number;      // (0-1) negativo
 *     gastosOp: number;         // (0-1) negativo
 *     otros: number;            // (0-1)
 *     impuestos: number;        // (0-1) negativo
 *   }>
 */

import {
  PUBLICACION_SYSTEM_PROMPT,
  type PublicacionPromptTemplate,
} from "./base";
import type { PublicacionPromptContext } from "../types";

type DupontRow = {
  entidad: string;
  roe: number;
  roa: number;
  apalancamiento: number;
  mon: number;
  mfb: number;
  isfn: number;
  provisiones: number;
  gastosOp: number;
  otros: number;
  impuestos: number;
};

export const promptDupontRentabilidad: PublicacionPromptTemplate = {
  version: "v2-chart",
  tema: "dupont_rentabilidad",
  hashtagsDefault: [
    "#Rentabilidad",
    "#DuPont",
    "#ROE",
    "#SistemaFinancieroPeruano",
    "#GestionFinanciera",
  ],
  build(ctx: PublicacionPromptContext): { system: string; user: string } {
    const entidades = (ctx.contexto.entidades ?? []) as DupontRow[];

    const sortedByRoe = [...entidades].sort((a, b) => b.roe - a.roe);
    const mejor = sortedByRoe[0];
    const peor = sortedByRoe[sortedByRoe.length - 1];
    const promRoe = entidades.length > 0
      ? entidades.reduce((s, e) => s + e.roe, 0) / entidades.length
      : 0;

    const fmt = (v: number) => (v * 100).toFixed(2);
    const fmtSigned = (v: number) => {
      const s = (v * 100).toFixed(2);
      return v >= 0 ? `+${s}` : s;
    };
    const fmtMult = (v: number) => v.toFixed(2);

    const tabla = entidades
      .map((e) => {
        const marca = e.entidad === ctx.entidadPropia ? " ← ENTIDAD PROPIA" : "";
        return `| ${e.entidad.padEnd(28)} | ${fmt(e.roe).padStart(6)}% | ${fmt(e.roa).padStart(6)}% | ${fmtMult(e.apalancamiento).padStart(5)}x | ${fmtSigned(e.mon).padStart(7)}% | ${fmtSigned(e.mfb).padStart(7)}% | ${fmtSigned(e.provisiones).padStart(7)}% | ${fmtSigned(e.gastosOp).padStart(7)}% |${marca}`;
      })
      .join("\n");

    const user = `# ARTICULO: Rentabilidad patrimonial (DuPont) — Cierre ${ctx.periodoLabel}

## Contexto del articulo
Cliente objetivo: ${ctx.entidadPropia}
Grupo comparable (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}

## Data del cierre (% sobre activo promedio TTM, ROE sobre patrimonio)
| Entidad                       | ROE    | ROA    | Apal   | MON     | MFB     | Provis  | GastosOp|
|-------------------------------|--------|--------|--------|---------|---------|---------|---------|
${tabla}

Referencia del grupo:
- ROE promedio: ${fmt(promRoe)}%
- Lider ROE: ${mejor?.entidad ?? "—"} (${mejor ? fmt(mejor.roe) : "0.00"}% con apalancamiento ${mejor ? fmtMult(mejor.apalancamiento) : "0.00"}x)
- Rezagado ROE: ${peor?.entidad ?? "—"} (${peor ? fmt(peor.roe) : "0.00"}%)

## GLOSARIO CRITICO (formula DuPont):
- **ROE = ROA × Apalancamiento (Activo/Patrimonio)**. Un ROE alto puede venir de ROA alto (eficiencia) o de mucho apalancamiento (riesgo).
- **ROA = MON + Otros + Impuestos** (aproximacion — signos naturales).
- **MON (Margen Operacional Neto) = MFB + ISFN - Personal - Generales - Provisiones**. Es el motor operativo antes de otros ingresos e impuestos.
- **MFB (Margen Financiero Bruto)**: rendimiento de cartera menos costo de fondeo. Es el core del negocio bancario.
- Dos entidades con el mismo ROE pueden tener CALIDAD muy distinta: una con MFB alto + provisiones controladas (sana) vs otra con apalancamiento alto + provisiones bajas (riesgosa si sube CAR).

## INSTRUCCIONES ESPECIFICAS PARA ESTE ARTICULO:

ANGULO EDITORIAL: no solo "quien tiene mas ROE" — el articulo tiene que responder "por que". Descomposicion DuPont es la herramienta.

## PLACEHOLDERS DE CHARTS

En el markdown debes incluir EXACTAMENTE dos placeholders, cada uno en su propia linea:

    [[CHART:chart-dupont-roe]]     <- bar chart ranking ROE del cierre
    [[CHART:chart-dupont-roa]]     <- bar chart ranking ROA (motor operativo)

Ubicacion sugerida:
- [[CHART:chart-dupont-roe]] DESPUES de la apertura, antes de la Seccion 1.
- [[CHART:chart-dupont-roa]] antes de la Seccion 2 (para complementar la descomposicion).

ESTRUCTURA sugerida:
- **Titulo**: enfoque causal. Ej: "ROE de cajas municipales al cierre ${ctx.periodoLabel}: quien gana por eficiencia y quien gana por apalancamiento"
- **Apertura**: cifra de ROE mas destacada + tension ("pero un ROE alto puede esconder riesgos").
- **[[CHART:chart-dupont-roe]]** — line del placeholder solo.
- **Seccion 1 — 📊 El ranking del ROE**: interpreta el chart. Menciona TODAS las entidades.
- **[[CHART:chart-dupont-roa]]**
- **Seccion 2 — 💡 Que motor lo explica**: descompone. Compara ROA vs ROE. Distingue ROA-driven vs Apalancamiento-driven usando el chart de ROA.
- **Seccion 3 — ⚠️ Calidad del margen**: analiza sostenibilidad. Provisiones bajas hoy pueden revertir. MFB alto + eficiencia son estructurales.
- **Cierre**: sintesis + pregunta retadora para ${ctx.entidadPropia}. Ej: "¿Es el ROE de ${ctx.entidadPropia} un margen sostenible o depende de un motor coyuntural?"

Recuerda: prosa continua, subtitulos con emoji + titulo, bold moderado en cifras clave, cero bullets en el cuerpo. Los charts NO se describen visualmente — se INTERPRETAN.

Output: JSON exacto con {titulo, contenidoMd, hashtags} — nada mas. En contenidoMd asegurate de incluir AMBOS placeholders exactamente una vez cada uno.`;

    return { system: PUBLICACION_SYSTEM_PROMPT, user };
  },
};
