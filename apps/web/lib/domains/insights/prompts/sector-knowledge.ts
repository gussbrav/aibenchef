/**
 * Sector Knowledge Base — vocabulario y umbrales del sistema financiero
 * peruano regulado por SBS.
 *
 * Se INYECTA al system prompt de todos los templates para que el LLM
 * use terminología correcta (ni banca_mundial ni jerga argentina).
 *
 * Fuentes:
 *   - Reglamentos SBS (Res. 11356-2008 mora, 18400-2010 clasificacion,
 *     etc.)
 *   - Informes de clasificadoras: Moody's Local, Apoyo & Asociados (Fitch),
 *     Equilibrium, PCR, Class & Asociados
 *   - MVs del proyecto: v_eeff_balance_ancho, mv_eeff_resultados_ancho,
 *     v_mora_global_por_entidad, v_kpis_anuales_entidad
 *
 * Mantenlo sincronizado con nueva terminología cuando SBS emita normas
 * relevantes (ej. cambio de criterios de provisiones o categorias).
 */

export const SECTOR_KNOWLEDGE_SBS = `
CONOCIMIENTO DEL SISTEMA FINANCIERO PERUANO (SBS):

TIPOS DE ENTIDAD (por marco regulatorio):
- BANCOS: Ley 26702, mayor tamaño, cartera diversificada retail+corporate.
  Media sistema: ROE 15-20%, Mora Global 3-4%, Ratio Capital Global 14-16%.
- FINANCIERAS: como bancos pero sin captacion cta corriente. Foco consumo
  y microempresa. ROE 10-18%, Mora 4-6%, Ratio Capital 14-17%.
- CMAC (Cajas Municipales): microfinanzas + PYME, accionista = Municipalidad.
  ROE 8-15%, Mora 4-6%, Ratio Capital 14-18%.
- CRAC (Cajas Rurales): microfinanzas rurales, mas pequeñas y volatiles.
  ROE muy variable, Mora 5-9%, Ratio Capital 13-16%.
- EDPYMES: solo colocaciones (sin captacion), microempresa. Mas pequeñas.
  ROE 5-15%, Mora 4-7%, Ratio Capital 13-16%.

TERMINOLOGIA DE CALIDAD DE CARTERA (jerarquia de peor a mejor):
1. Cartera Atrasada = Vencida + En Cobranza Judicial (mora simple)
2. Cartera de Alto Riesgo (CAR) = Atrasada + Refinanciada
3. Cartera Problema = Atrasada + Refinanciada + Reestructurada
4. Cartera Problema con Castigos LTM = Problema + Castigos ultimos 12 meses
   (indicador ajustado que revela LIMPIEZA activa de balance)
5. Cartera Bruta = Colocaciones totales sin descontar provisiones
6. Cartera Neta = Cartera Bruta - Provisiones (lo que queda "vivo")

INDICADORES CLAVE (nombre estandar clasificadoras + formula):
- Mora Global = Cartera Atrasada / Cartera Bruta
- % CAR = CAR / Cartera Bruta
- Cobertura CAR = Provisiones / CAR (>100% deseable, <80% alerta)
- Cobertura Cartera Problema = Provisiones / Cartera Problema
- Compromiso Patrimonial = (Cartera Problema - Provisiones) / Patrimonio
  Si > 0: hay riesgo latente al patrimonio. Negativo es SANO.
- Castigos LTM / Cartera+Castigos = intensidad de limpieza de balance

RENTABILIDAD (nomenclatura clasificadoras):
- ROAE = ROE = Utilidad Neta / Patrimonio Promedio 12m
- ROAA = ROA = Utilidad Neta / Activos Promedio 12m
- Margen Financiero Bruto = (Ingresos Fin - Gastos Fin) / Ingresos Fin
- Margen Financiero Neto = Margen Bruto + INOF Neto - Provisiones
- Margen Operacional Neto = Margen Fin Neto + Ing Neto Servicios - Gastos Op
- Margen Neto = Utilidad Neta / Ingresos Financieros

EFICIENCIA:
- Gastos Op / Ingresos Fin = mide productividad simple
- Eficiencia Operacional = Gasto Op / (Utilidad Fin Bruta + Ing Serv +
  INOF). Mejor metrica: <50% clase mundial, 50-60% aceptable, >60% alerta.

SOLVENCIA:
- Ratio Capital Global = Patrimonio Efectivo / Activos y Contingentes
  Ponderados por Riesgo. Minimo legal SBS = 8.5%. Buffer conservador >14%.
- Fondos Capital Primario / APR = equivalente CET1. Minimo SBS 4.5%.
  Empresas fuertes >10%.
- Metodo ASA (Standardised Approach Alternative) vs Metodo Estandar SBS:
  ASA reduce APR ~15-20%, mejora ratio capital. Aplicable a expuestas
  a hipotecario y consumo.

LIQUIDEZ (los legales):
- RCL MN/ME (Ratio Cobertura Liquidez): activos liquidos / salidas neto
  30d. Minimo 100%. Regulacion Basilea III adaptada.
- RIL MN/ME (Ratio Inversiones Liquidas): activos liquidos alta calidad /
  pasivos totales.
- Ratio Liquidez SBS legal: MN >=8%, ME >=20% obligatorio.
- Concentracion 20 mayores depositantes: <15% deseable, >20% alerta
  de riesgo de fondeo.

FONDEO (composicion de pasivos):
- Depositos y Obligaciones con el Publico: fondeo minorista, mas estable
- Adeudados y Obligaciones Financieras: fondeo mayorista (COFIDE, otros
  bancos)
- Emisiones: bonos, papeles comerciales
- Bonos Subordinados: capital hibrido, computan en Capital Nivel 2

FRAMEWORK DE ANALISIS QUE USAN LAS CLASIFICADORAS PROFESIONALES:
Cada analisis toca sistematicamente 5 DIMENSIONES:
1. POSICIONAMIENTO COMPETITIVO — ranking en su tipo, share, cobertura
   geografica, especializacion sectorial
2. CALIDAD DE ACTIVOS — mora, cartera problema, castigos, cobertura,
   compromiso patrimonial, concentracion crediticia
3. SOLVENCIA — ratio capital global, capital primario, respaldo del
   accionista, generacion organica de capital
4. LIQUIDEZ Y FONDEO — RCL/RIL, composicion pasivos, concentracion
   depositantes, acceso a fuentes de fondeo
5. RENTABILIDAD Y EFICIENCIA — ROAE, ROAA, spread, margen operacional,
   eficiencia, sostenibilidad de ingresos

CADA ANALISIS INCLUYE ademas cuando aplique:
- MEDIDAS MITIGANTES adoptadas por la entidad (ej: emisiones subordinadas,
  capitalizacion utilidades, aplicacion metodo ASA)
- CONTEXTO MACRO/SECTORIAL (ej: crisis social zona sur 2023, tasas altas
  2024, ciclo credito)
- RESPALDO DEL ACCIONISTA (los CMAC dependen de sus municipalidades,
  edpymes de sus grupos)
`.trim();

/**
 * Version corta cuando el contexto de tokens es limitado. Se usa en
 * prompts que ya tienen mucho contexto (waterfall, bubble, comparativas
 * multi-periodo).
 */
export const SECTOR_KNOWLEDGE_SBS_SHORT = `
CONTEXTO SBS PERU (referencia rapida):
- Tipos: BANCOS (retail+corp), FINANCIERAS (consumo+MYPE), CMAC (micro,
  accionista Municipalidad), CRAC (rural), EDPYMES (solo colocaciones).
- Terminologia mora: Atrasada < CAR < Cartera Problema < Cartera Problema
  con Castigos LTM. Nombre ISO: Cartera Atrasada / Cartera Bruta = Mora.
- Cobertura ideal: Provisiones / CAR >100%, Compromiso Patrimonial <0.
- Ratio Capital Global minimo SBS 8.5%, buffer conservador >14%.
- Eficiencia Operacional <50% clase mundial.
- Metodo ASA vs Estandar: ASA reduce APR ~15-20%.
- Framework: posicionamiento + calidad + solvencia + liquidez + rentabilidad.
`.trim();
