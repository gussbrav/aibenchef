/**
 * Meta de temas — client-safe (no importa nada server-only).
 *
 * Vive aparte del service.ts porque este ultimo tiene `import "server-only"`
 * y no puede aparecer en el bundle del client. La UI (client component)
 * importa desde este modulo para el selector de temas del wizard.
 */

import { promptBenchmarkingSectorial } from "./prompts/benchmarking-sectorial";
import { promptCoyunturaMacro } from "./prompts/coyuntura-macro";
import { promptDupontRentabilidad } from "./prompts/dupont-rentabilidad";
import { promptEvolucionPeSegmento } from "./prompts/evolucion-pe-segmento";
import { promptMoraVisual } from "./prompts/mora-visual";
import { promptRentabilidadVisual } from "./prompts/rentabilidad-visual";
import type { PublicacionTema } from "./types";

export const PUBLICACION_TEMAS_META: Record<
  PublicacionTema,
  { label: string; descripcion: string; hashtagsDefault: string[]; charts?: boolean }
> = {
  mora_visual: {
    label: "Mora visual (con gráfico)",
    descripcion:
      "Radiografía de mora global — evolución mensual últimos 24 meses con gráfico embebido. Estilo NYT.",
    hashtagsDefault: promptMoraVisual.hashtagsDefault,
    charts: true,
  },
  rentabilidad_visual: {
    label: "Rentabilidad visual (con gráficos)",
    descripcion:
      "ROE del grupo comparable — evolución 5 años + ranking del cierre. 2 gráficos embebidos.",
    hashtagsDefault: promptRentabilidadVisual.hashtagsDefault,
    charts: true,
  },
  benchmarking_sectorial: {
    label: "Benchmarking sectorial",
    descripcion:
      "Ranking del cierre entre entidades comparables: quien lidera y por que. Incluye bar chart del ranking.",
    hashtagsDefault: promptBenchmarkingSectorial.hashtagsDefault,
    charts: true,
  },
  coyuntura_macro: {
    label: "Coyuntura macro",
    descripcion:
      "Conecta la data del cierre con eventos macro (El Niño, tasas BCRP, elecciones). Incluye bar chart del ranking.",
    hashtagsDefault: promptCoyunturaMacro.hashtagsDefault,
    charts: true,
  },
  dupont_rentabilidad: {
    label: "DuPont / Rentabilidad",
    descripcion:
      "Descomposicion del ROE: quien gana por eficiencia vs quien gana por apalancamiento. Incluye bar charts de ROE y ROA.",
    hashtagsDefault: promptDupontRentabilidad.hashtagsDefault,
    charts: true,
  },
  evolucion_pe_segmento: {
    label: "Evolucion PE por segmento",
    descripcion:
      "Historia del Punto de Equilibrio en los ultimos cierres: quien mejoro y quien esta bajo presion. Incluye line chart de evolucion.",
    hashtagsDefault: promptEvolucionPeSegmento.hashtagsDefault,
    charts: true,
  },
};
