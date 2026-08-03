/**
 * Prompt template para "Liquidez y Fondeo" — evalua la robustez del
 * balance en base a la composicion de pasivos y cobertura de liquidez.
 *
 * Contexto esperado en ctx.contexto:
 *   serie: Array<{
 *     entidad: string;
 *     depositosTotales: number;    // MM S/
 *     adeudados: number;           // MM S/
 *     emisiones?: number;          // MM S/ (bonos, papeles)
 *     rclMn?: number;              // Ratio Cobertura Liquidez MN (0-inf, 1=100%)
 *     rclMe?: number;              // idem ME
 *     concentracion20?: number;    // % 20 mayores depositantes / total
 *   }>
 */

import { SYSTEM_PROMPT_BASE, type PromptTemplate } from "./base";
import type { PromptContext } from "../types";

type LiquidezRow = {
  entidad: string;
  depositosTotales: number;
  adeudados: number;
  emisiones?: number;
  rclMn?: number;
  rclMe?: number;
  concentracion20?: number;
};

export const promptLiquidez: PromptTemplate = {
  version: "v1",
  seccion: "liquidez",
  build(ctx: PromptContext): { system: string; user: string } {
    const serie = (ctx.contexto.serie ?? []) as LiquidezRow[];

    const tabla = serie
      .map((r) => {
        const dep = r.depositosTotales.toLocaleString("es-PE", { maximumFractionDigits: 0 });
        const ade = r.adeudados.toLocaleString("es-PE", { maximumFractionDigits: 0 });
        const emi = r.emisiones != null
          ? r.emisiones.toLocaleString("es-PE", { maximumFractionDigits: 0 })
          : "—";
        const total = r.depositosTotales + r.adeudados + (r.emisiones ?? 0);
        const depShare = total > 0
          ? ((r.depositosTotales / total) * 100).toFixed(1) + "%"
          : "—";
        const rclMn = r.rclMn != null ? (r.rclMn * 100).toFixed(0) + "%" : "—";
        const rclMe = r.rclMe != null ? (r.rclMe * 100).toFixed(0) + "%" : "—";
        const conc = r.concentracion20 != null
          ? (r.concentracion20 * 100).toFixed(1) + "%"
          : "—";
        return `| ${r.entidad.padEnd(30)} | ${dep.padStart(10)} | ${ade.padStart(9)} | ${emi.padStart(7)} | ${depShare.padStart(5)} | ${rclMn.padStart(6)} | ${rclMe.padStart(6)} | ${conc.padStart(6)} |`;
      })
      .join("\n");

    const user = `# Liquidez y Fondeo — ${ctx.periodoLabel}

Cliente objetivo: ${ctx.entidadPropia}
Peer group (${ctx.peerGroup.length} entidades): ${ctx.peerGroup.join(", ")}

Composicion de fondeo (MM S/) e indicadores de liquidez:
| Entidad                        | Depositos  | Adeudad   | Emision | %Dep  | RCL MN | RCL ME | Conc.20 |
|--------------------------------|------------|-----------|---------|-------|--------|--------|---------|
${tabla}

Definiciones (interno, no mencionar):
- Depositos: fondeo minorista (obligaciones con el publico), mas estable
- Adeudados: fondeo mayorista (COFIDE, bancos, IFIs), mas costoso y volatil
- Emisiones: bonos corporativos, subordinados, papeles comerciales
- %Dep = Depositos / Total fondeo. Mayor % = mejor calidad de fondeo.
- RCL (Ratio Cobertura Liquidez): activos liquidos alta calidad / salidas neto 30d. Minimo SBS 100%.
- Concentracion 20 mayores depositantes: <15% saludable, >20% alerta de fondeo.

Aplica el framework de clasificadora sobre LIQUIDEZ Y FONDEO:
- ¿${ctx.entidadPropia} tiene fondeo estable (alto %Dep) o dependiente de mayorista?
- ¿Los RCL cumplen holgadamente el minimo legal (>100%)? Alerta si alguna esta cerca.
- Concentracion: si algun peer tiene >20%, mencionar como riesgo de retiro grande.
- Menciona TODAS las entidades. Compara composicion de fondeo.
- Contexto sectorial: CMAC/CRAC dependen de depositos publico (bien), EDPYMES y Financieras usan mas adeudados (peor).
- Implicancia: capacidad de sostener crecimiento y aguantar estres de liquidez.

Output: 5-7 bullets JSON array. Nada mas.`;

    return { system: SYSTEM_PROMPT_BASE, user };
  },
};
