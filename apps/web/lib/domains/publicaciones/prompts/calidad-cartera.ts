/**
 * Prompt template: "Calidad de Cartera" — articulo long-form sobre el
 * ranking de riesgo crediticio ajustado (Cartera de Alto Riesgo Ajustada)
 * y su respaldo de provisiones (Cobertura), matricializado por cuadrante.
 *
 * El indicador CAR Ajustada incluye cartera vencida + judicial +
 * refinanciada + venta/transferencia de cartera atrasada (definicion
 * SBS oficial del reporte prudencial mensual). Es el mejor proxy de
 * "riesgo real" de una entidad — muy superior a la simple mora.
 *
 * Contexto esperado en ctx.contexto:
 *   entidadPropia: string
 *   entidades: Array<{
 *     entidad: string;
 *     carAjustada: number;  // % (5-25 tipico), menor = mejor
 *     cobertura: number;    // % (80-250 tipico), mayor = mejor
 *   }>
 */

import {
  PUBLICACION_SYSTEM_PROMPT,
  type PublicacionPromptTemplate,
} from "./base";
import type { PublicacionPromptContext } from "../types";

type CalidadRow = {
  entidad: string;
  carAjustada: number;
  cobertura: number;
};

export const promptCalidadCartera: PublicacionPromptTemplate = {
  version: "v1",
  tema: "calidad_cartera",
  hashtagsDefault: [
    "#SistemaFinancieroPeruano",
    "#GestionDeRiesgo",
    "#CalidadDeCartera",
    "#SBS",
    "#Microfinanzas",
  ],
  build(ctx: PublicacionPromptContext): { system: string; user: string } {
    const entidadPropia = (ctx.contexto.entidadPropia as string | undefined) ?? "";
    const entidades = (ctx.contexto.entidades ?? []) as CalidadRow[];

    // Orden por CAR ajustada ascendente (menor = mejor calidad)
    const sortedByCar = [...entidades].sort((a, b) => a.carAjustada - b.carAjustada);
    const mejor = sortedByCar[0];
    const peor = sortedByCar[sortedByCar.length - 1];

    // Mediana simple para clasificar cuadrantes internos
    const cars = entidades.map((e) => e.carAjustada).sort((a, b) => a - b);
    const covs = entidades.map((e) => e.cobertura).sort((a, b) => a - b);
    const medCar = cars[Math.floor(cars.length / 2)] ?? 0;
    const medCov = covs[Math.floor(covs.length / 2)] ?? 0;

    // Cuadrantes:
    //   SEGURO (bajo car, alta cov):      car <= medCar AND cov >= medCov
    //   SOBRECOBERTURA (alto car, alta):  car > medCar  AND cov >= medCov
    //   OPTIMISTA (bajo car, baja cov):   car <= medCar AND cov < medCov
    //   FRAGIL (alto car, baja cov):      car > medCar  AND cov < medCov
    const clasificar = (e: CalidadRow): "SEGURO" | "SOBRECOBERTURA" | "OPTIMISTA" | "FRAGIL" => {
      if (e.carAjustada <= medCar && e.cobertura >= medCov) return "SEGURO";
      if (e.carAjustada > medCar && e.cobertura >= medCov) return "SOBRECOBERTURA";
      if (e.carAjustada <= medCar && e.cobertura < medCov) return "OPTIMISTA";
      return "FRAGIL";
    };

    const tabla = sortedByCar
      .map((e) => {
        const flag = e.entidad === entidadPropia ? " ★" : "";
        return `${e.entidad}${flag} · CAR Ajustada: ${e.carAjustada.toFixed(
          2,
        )}% · Cobertura: ${e.cobertura.toFixed(2)}% · [${clasificar(e)}]`;
      })
      .join("\n");

    const propiaData = entidades.find((e) => e.entidad === entidadPropia);
    const propiaInfo = propiaData
      ? `\nEntidad de referencia: ${entidadPropia}\n  CAR Ajustada: ${propiaData.carAjustada.toFixed(
          2,
        )}% (posicion ${
          sortedByCar.findIndex((e) => e.entidad === entidadPropia) + 1
        } de ${sortedByCar.length}, menor = mejor)\n  Cobertura: ${propiaData.cobertura.toFixed(
          2,
        )}%\n  Cuadrante: ${clasificar(propiaData)}\n`
      : "";

    const user = `Genera un articulo profesional (400-600 palabras) para LinkedIn sobre la calidad de cartera del grupo comparable al cierre ${ctx.periodoLabel}. Fuente: reporte prudencial oficial SBS.

DATOS (ordenados de MEJOR a PEOR calidad ajustada):
${tabla}
${propiaInfo}

ESTRUCTURA REQUERIDA:

1. **Titulo llamativo** (h1): destaca al lider (${mejor?.entidad ?? "N/A"} con ${mejor?.carAjustada.toFixed(2) ?? "?"}% CAR Ajustada) o al patron mas revelador del cuadro.

2. **Contexto (1 parrafo)**: Explica que es la "Cartera de Alto Riesgo Ajustada": el mejor indicador de riesgo real. Incluye cartera vencida, en cobranza judicial, refinanciada, venta/transferencia de cartera atrasada — mucho mas exigente que la simple mora. La cobertura de provisiones muestra el colchon disponible para absorber esas perdidas.

3. **Tabla con emoji de bandera 🚩/🥇** por entidad, mostrando: Entidad | CAR Ajustada | Cobertura. Usa formato de tabla markdown.

4. **Analisis por cuadrante** (parrafos separados, 1 por cuadrante relevante):
   - 🥇 **Seguro** (bajo riesgo + alta cobertura): quienes lo dominan, que estrategia sugiere.
   - ⚠️ **Fragil** (alto riesgo + baja cobertura): quienes cuidar, riesgo de El Nino / shock.
   - 🛡️ **Sobre-cubierto** (alto riesgo + alta cobertura): estan protegidos aunque la cartera este stressada.
   - 📊 **Optimista** (bajo riesgo + baja cobertura): la calidad se ve bien pero el colchon es delgado.

5. **Insight con ${entidadPropia}** (si esta en el peer): 1-2 lineas sobre en que cuadrante cae y que significa. Constructivo, no auto-elogio.

6. **Cierre con pregunta**: al lector directivo — invita al debate o reflexion.

7. **Hashtags**: los canonicos + 1-2 contextuales al mes/coyuntura si aplica.

REGLAS DE ESTILO:
- Tono de analista senior peruano. Autoridad + humildad. Tuteo peruano estricto (tu/tienes/puedes/haz) — NUNCA voseo argentino ni imperativos con tilde final.
- Datos EXACTOS del cuadro (no aproximes: "6.29%", no "aprox 6%").
- 400-600 palabras total.
- No cites la fuente como "Aibenchef". Cita "SBS" o "reporte prudencial SBS".
- Prohibido inventar cifras que no estan en el cuadro.
- No uses la palabra "IMPERIALES" ni marketing exagerado — busca autoridad tecnica.
`;

    return { system: PUBLICACION_SYSTEM_PROMPT, user };
  },
};
