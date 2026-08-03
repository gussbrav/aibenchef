/**
 * Sector Knowledge Base v2 — vocabulario, marco analitico y estilo
 * narrativo del sistema financiero peruano regulado por SBS.
 *
 * Extraido de reportes reales de las clasificadoras:
 *   - Moody's Local Peru (Caja Arequipa 2023, Mibanco Mar-26, BCP Jul-26)
 *   - Apoyo & Asociados / Fitch (Caja Arequipa 2025)
 *   - MicroRate (CMAC Piura Mar-26)
 *
 * Se INYECTA al system prompt de todos los templates para que el LLM
 * (i) use la terminologia correcta, (ii) siga el framework 5D estandar
 * de las clasificadoras y (iii) escriba con el estilo narrativo del sector.
 */

export const SECTOR_KNOWLEDGE_SBS = `
CONOCIMIENTO DEL SISTEMA FINANCIERO PERUANO (SBS):

TIPOS DE ENTIDAD (por marco regulatorio):
- BANCOS: Ley 26702, mayor tamaño, cartera diversificada retail+corporate.
  Media sistema: ROE 15-25%, Mora Global 3-5%, Ratio Capital Global 14-17%.
- FINANCIERAS: como bancos pero sin captacion cta corriente. Foco consumo
  y microempresa. ROE 10-20%, Mora 4-7%, Ratio Capital 14-18%.
- CMAC (Cajas Municipales): microfinanzas + PYME, accionista = Municipalidad.
  ROE 8-17%, Mora 6-10%, Ratio Capital 13-16%. Promedio CMAC SBS Dic-25:
  Ratio Capital 14.2%, CAR 7.3%, Cobertura Prov 116.9%.
- CRAC (Cajas Rurales): microfinanzas rurales, mas pequeñas y volatiles.
  ROE muy variable, Mora 6-10%, Ratio Capital 13-16%.
- EDPYMES: solo colocaciones (sin captacion), microempresa. Mas pequeñas.
  ROE 5-15%, Mora 5-9%, Ratio Capital 13-17%.
- BANCA ESPECIALIZADA EN MICROFINANZAS: incluye Mibanco y Compartamos.
  Mora mas alta que Banca Multiple pero menor que otras microfinancieras.

TERMINOLOGIA DE CALIDAD DE CARTERA (jerarquia de peor a mejor):
1. Cartera Atrasada = Vencida + En Cobranza Judicial (mora simple)
2. Cartera de Alto Riesgo (CAR) = Atrasada + Refinanciada
3. Cartera Problema = Atrasada + Refinanciada + Reestructurada
4. MORA REAL = Cartera Problema + Castigos LTM / Cartera Bruta Ajustada.
   Es la metrica que las clasificadoras usan para evaluar el riesgo
   REAL — no la mora simple que subestima al ignorar castigos.
5. Cartera Bruta = Colocaciones totales sin descontar provisiones
6. Cartera Neta = Cartera Bruta - Provisiones

SEGMENTACION DE COLOCACIONES SBS (de menor a mayor riesgo tipico):
1. Corporativos (>=200 MM ventas/anio)
2. Grandes Empresas (20-200 MM ventas/anio)
3. Medianas Empresas (<20 MM ventas, deuda >300k)
4. Pequeñas Empresas / MYPE (deuda 20k-300k)
5. Microempresas / MYPE (deuda <20k)
6. Consumo (Revolvente + No Revolvente)
7. Hipotecarios para Vivienda (menor riesgo por garantia real)

Cada segmento tiene: (i) rendimiento distinto (micro > consumo > hipot >
corp), (ii) regulacion de provisiones distinta, (iii) perfil de deudor
distinto. La MEZCLA de portfolio explica muchas veces las diferencias
entre entidades del mismo tipo.

INDICADORES CLAVE (nomenclatura exacta clasificadoras):
- Mora Global = Cartera Atrasada / Cartera Bruta (mora simple)
- Mora Real = Cartera Problema con Castigos / Cartera Bruta Ajustada
- % CAR = CAR / Cartera Bruta
- Refinanciados / CAR = participacion de refinanciados dentro del CAR
- Cobertura CAR = Provisiones / CAR (>100% deseable, <80% alerta)
- Cobertura Cartera Problema = Provisiones / Cartera Problema
- Compromiso Patrimonial = (Cartera Problema - Provisiones) / Patrimonio.
  Negativo es SANO. >0 = riesgo latente. >10% = alerta clasificadora.
- Castigos LTM / (Cartera + Castigos LTM) = intensidad de limpieza

PROVISIONES:
- Provisiones Obligatorias: por normativa SBS segun categoria de riesgo
  (Normal, CPP, Deficiente, Dudoso, Perdida)
- Provisiones Voluntarias: buffer discrecional del banco. Su nivel indica
  vision conservadora de la gerencia. Ejemplo: BCP Mar-26 tiene 29.38%
  del total de provisiones como voluntarias (S/1,944.3 MM).

RENTABILIDAD (nomenclatura clasificadoras):
- ROAE = ROE = Utilidad Neta / Patrimonio Promedio 12m
- ROAA = ROA = Utilidad Neta / Activos Promedio 12m
- Margen Financiero Bruto = (Ingresos Fin - Gastos Fin) / Ingresos Fin
- Margen Financiero Neto = Margen Bruto - Provisiones
- Margen Operacional Neto = Margen Fin Neto + Ing Neto Servicios - Gastos Op
- Margen Neto = Utilidad Neta / Ingresos Financieros
- Spread Financiero = Rendimiento Cartera - Costo Fondeo
- Rendimiento de Cartera: ingresos financieros / cartera promedio

EFICIENCIA:
- Gastos Op / Ingresos Fin = mide productividad simple
- Eficiencia Operacional = Gasto Op / (Utilidad Fin Bruta + Ing Serv
  Netos + INOF). <50% clase mundial, 50-60% aceptable, >60% alerta.
- Costo de Fondeo: gastos financieros / pasivos costeados. BCP tiene el
  costo mas bajo del mercado (< 3.5%). Ejemplo Mibanco 4.58% Dic-25.

SOLVENCIA:
- Ratio Capital Global = Patrimonio Efectivo / APR (Activos Ponderados
  por Riesgo). Minimo legal SBS = 8.5%. Buffer conservador >14%.
  BCP Mar-26: 16.70%. Mibanco Dic-25: 21.25%. Media Banca Multiple: 16.55%.
- Fondos Capital Primario / APR = equivalente CET1. Minimo SBS 4.5%.
  Empresas fuertes >10%. BCP: 10.96%.
- Deuda / Patrimonio: apalancamiento contable.
- Metodo ASA (Standardised Approach Alternative) vs Metodo Estandar SBS:
  ASA reduce APR ~15-20%, mejora ratio capital. Requiere licencia SBS.
- Bonos Subordinados: capital hibrido, computan como Patrimonio de
  Nivel 2. Emisiones tipicas via COFIDE (Programa de Fortalecimiento
  Patrimonial post-COVID) o mercado de capitales local.
- Redencion anticipada de bonos = señal de fortaleza (cuentas con
  liquidez para cancelar antes de vencimiento). Reciente: Mibanco redimio
  la Primera Emision del Segundo Programa en dic-2025.

LIQUIDEZ (marco regulatorio SBS):
- RCL MN/ME (Ratio Cobertura Liquidez): activos liquidos alta calidad /
  salidas neto 30d. Minimo 100%. Basilea III adaptada.
- RIL MN/ME (Ratio Inversiones Liquidas)
- Ratio Liquidez SBS legal: MN >=8%, ME >=20% obligatorio.
- Concentracion 20 mayores depositantes: <15% deseable, >20% alerta.
  Ejemplo excelente CMAC Piura Dic-25: 3.7% (muy atomizado).
- Analisis de Calce: brechas por tramos (30d, 30-90d, 90-180d, 180-360d,
  >360d) en MN y ME. Idealmente superavit acumulado. Deficit en tramo
  largo se mitiga con Plan de Contingencia de Liquidez.
- Plan de Contingencia de Liquidez: obligatorio SBS. Incluye acceso a
  operaciones de reporte con BCR, lineas con IFIs, mercado de capitales.

COMPOSICION DE FONDEO:
- Depositos y Obligaciones con el Publico (retail): fondeo estable de
  bajo costo. Objetivo estrategico incrementarlo. Se subdivide en:
  * Ahorros (mas estable)
  * Depositos a Plazo Fijo (< estable, mas sensible a tasa)
  * Cuentas corrientes (solo Bancos, sin costo)
- Adeudados y Obligaciones Financieras: mayorista (COFIDE, IFIs). Mas
  costoso pero flexible. Incluye operaciones de reporte con BCR.
- Emisiones: bonos corporativos, papeles comerciales, certificados de
  depositos negociables (CDN)
- Bonos Subordinados: aparte de emisiones normales, computan como capital

PROGRAMAS GOBIERNO CON GARANTIA (afectan portfolio y provisiones):
- Reactiva Peru (2020): COVID, garantia parcial del Estado
- Impulso MyPerú (2023): post-pandemia, garantia parcial
- FAE-MYPE, FAE-Turismo: sectoriales
La cartera de estos programas TIENE garantia estatal, por lo que
requiere menos provision. Su reduccion en % de cartera indica retorno
a colocacion "regular" post-shocks.

CANALES DIGITALES:
- Yape (BCP Group): wallet lider Peru, driver de ingresos por servicios.
  Cambio competitivo importante 2023-2026.
- Banca movil de cada entidad
- Los ingresos netos por servicios financieros (fees) son cada vez mas
  importantes para diversificar la rentabilidad mas alla del spread.

EVENTOS SECTORIALES DE CONTEXTO (2022-2026):
- Crisis social zona sur (2023): impacto en calidad de cartera para
  entidades expuestas a Puno, Cusco, Apurimac, Arequipa Rural.
- Fenomeno El Niño (2023-2024, en curso 2026): riesgo climatologico
  para creditos agricolas y micro rurales.
- Tasas altas 2023-2024 con normalizacion progresiva 2025-2026.
- Consolidacion sector CMAC: adquisicion CMAC Sullana por CMAC Piura
  via bloque patrimonial (2024-2025).
- Ciclo electoral 2026: incertidumbre = mayor preservacion de liquidez.

FRAMEWORK DE ANALISIS QUE USAN LAS CLASIFICADORAS PROFESIONALES:
Cada analisis toca sistematicamente 5 DIMENSIONES + 2 SEC. TRANSVERSAL:
1. POSICIONAMIENTO COMPETITIVO — ranking en su tipo, share, cobertura
   geografica, especializacion sectorial, tercera en colocaciones/depositos
2. CALIDAD DE ACTIVOS — mora, cartera problema, CAR, castigos,
   cobertura, compromiso patrimonial, concentracion crediticia,
   distribucion por segmento MYPE/consumo/hipotecario
3. SOLVENCIA — ratio capital global, capital primario, respaldo del
   accionista, generacion organica de capital, emisiones subordinadas
4. LIQUIDEZ Y FONDEO — RCL/RIL, composicion pasivos, concentracion
   depositantes, acceso a fuentes de fondeo, analisis de calce
5. RENTABILIDAD Y EFICIENCIA — ROAE, ROAA, spread, margen operacional,
   eficiencia, sostenibilidad de ingresos, contribucion ingresos por
   servicios

TRANSVERSALES:
- MEDIDAS MITIGANTES adoptadas por la entidad: capitalizacion utilidades,
  emision bonos subordinados via Programa COFIDE, aplicacion metodo ASA,
  constitucion provisiones voluntarias, integracion de bloques patrimoniales
- CONTEXTO MACRO/SECTORIAL: crisis social zona sur, Fenomeno del Niño,
  ciclo electoral, tasas, adquisiciones sectoriales, cambios regulatorios
- RESPALDO DEL ACCIONISTA: CMAC dependen de sus Municipalidades, Mibanco
  del BCP/Credicorp, EDPYMES de sus grupos, Bancos privados de sus
  matrices internacionales

ESTILO NARRATIVO PROFESIONAL (usar estos moldes):
- "Se pondera favorable/negativamente..."
- "Cabe señalar / precisar que..."
- "Muy por encima / por debajo del minimo regulatorio"
- "Amplia holgura frente a los limites"
- "Se aprecia positivamente el equilibrio entre..."
- "Destaca la aplicacion de medidas de contencion de riesgos..."
- "Podria comprometer la generacion de flujos futuros"
- "Se mantiene alerta ante la posibilidad de..."
- "El indicador se ubica en X%, desde Y% en el ejercicio previo"
- "En linea con la estrategia de..."
- "En un contexto de mayor..."

QUE EVITAR:
- Adjetivos vacios: "excelente", "muy bueno", "fuerte", "importante"
  (sin cifra). Siempre acompañar con cifra exacta.
- Recomendar comprar/vender/mantener (no somos brokers).
- Inventar cifras. Solo usar las de la tabla dada.
- Redondeos ambiguos (usar la precision que da la tabla).
`.trim();

/**
 * Version corta cuando el contexto de tokens es limitado.
 */
export const SECTOR_KNOWLEDGE_SBS_SHORT = `
CONTEXTO SBS PERU (referencia rapida):
- Tipos: BANCOS (retail+corp), FINANCIERAS (consumo+MYPE), CMAC (micro,
  accionista Municipalidad), CRAC (rural), EDPYMES (solo colocaciones).
- Terminologia mora: Atrasada < CAR < Cartera Problema < MORA REAL (con
  castigos LTM). Mora Real es la metrica clasificadoras.
- Segmentos: Corporativos > Grandes > Medianas > Pequeñas > Micro >
  Consumo > Hipotecarios (menor a mayor riesgo tipico).
- Cobertura ideal: Provisiones / CAR >100%, Compromiso Patrimonial <0.
- Ratio Capital Global minimo SBS 8.5%, buffer conservador >14%.
- Media Banca Multiple: Ratio Capital 16.55%. Media CMAC: 14.2%.
- Eficiencia Operacional <50% clase mundial.
- Metodo ASA vs Estandar: ASA reduce APR ~15-20%.
- Framework 5D: posicionamiento + calidad + solvencia + liquidez + rentabilidad.
- Contexto 2026: crisis social zona sur, El Niño en curso, ciclo electoral.
`.trim();
