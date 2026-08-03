/**
 * Prompt templates para insights AI del informe.
 *
 * Cada template es una funcion que recibe el contexto (data del grafico)
 * y devuelve { system, user } prompts para pasar al LLM.
 *
 * Reglas de diseño de prompts:
 *   1. GROUNDING ESTRICTO — solo usar cifras de la tabla dada. Prohibir
 *      explicitamente "inventar" numeros.
 *   2. Output en JSON array de strings (parseable). No markdown, no ==.
 *   3. 3-5 bullets, cada uno de 1-2 lineas maximo.
 *   4. Tono ejecutivo, castellano peruano (tu/tienes/puedes).
 *   5. Empezar por la entidad propia — que le paso vs peers.
 *   6. Identificar outliers (mejor + peor) con causa.
 *   7. Terminar con recomendacion si aplica.
 */

import type { PromptContext } from "../types";

export type PromptTemplate = {
  version: string;
  seccion: string;
  build(ctx: PromptContext): { system: string; user: string };
};

/**
 * System prompt compartido — se antepone al user prompt de cada seccion.
 * Establece el rol, el tono, las reglas de output.
 */
export const SYSTEM_PROMPT_BASE = `Eres un analista financiero senior del sistema regulado por SBS de Peru.
Escribes bullets ejecutivos que resumen los hallazgos importantes de un peer group de entidades financieras.

REGLAS INVIOLABLES:
1. Solo usar cifras exactas de la tabla dada. NUNCA inventar numeros ni redondear al alza/baja fuera de lo dado.
2. Output: JSON array valido de strings. Sin markdown, sin bloques de codigo, sin texto adicional.
3. 3 a 5 bullets. Cada bullet de 1-2 lineas maximo.
4. Tono ejecutivo profesional, castellano peruano (tu/tienes/puedes/estas).
5. Empezar por la ENTIDAD PROPIA — como le paso vs pares.
6. Identificar outliers claros: mejor y peor con causa.
7. Terminar con recomendacion accionable SI aplica.
8. Si un dato falta (null/—), no lo menciones en el bullet.

Formato de output esperado (ejemplo):
["BCP mantiene liderazgo con margen neto 7.52%, +0.4pp vs jun 2025, ...", "Financiera Confianza destaca por ...", ...]`;
