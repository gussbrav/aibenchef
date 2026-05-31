---
name: aibenchef-sbs
description: Dominio SBS Peru — conoce las 5 categorias de entidades reguladas, 10 topicos, codigos de archivo, cuentas canonicas de Balance/GyP, indicadores regulatorios, formulas TTM y reglas del plan de cuentas SBS. Activa este skill cuando trabajes con parsers EEFF, queries de marts, calculos de ratios, golden datasets, o cualquier cosa que toque la nomenclatura regulatoria.
---

# Skill: dominio SBS Peru para Aibenchef

Conocimiento canonico del dominio que Aibenchef modela. Usarlo cuando se
toque cualquier cosa de SBS (parsers, queries, ratios, marts).

## 1. Entidades reguladas (5 grupos)

| Codigo | Grupo | Ejemplos |
|--------|-------|----------|
| BANCA_MULTIPLE | Bancos comerciales | BCP, BBVA, Interbank, Scotiabank |
| FINANCIERA | Financieras | Crediscotia, Compartamos, Mitsui Auto |
| CMAC | Cajas Municipales | Arequipa, Piura, Trujillo, Cusco, Huancayo, Sullana, Ica, Tacna, Maynas, Paita, Del Santa, Lima |
| CRAC | Cajas Rurales | Los Andes, Prymera, Cencosud, Raiz |
| EDPYME | EDPYMEs | BBVA Consumer, Mi Casita, Acceso Crediticio, Inversiones La Cruz |

**EDPYMEs NO captan depositos del publico** → NO tienen los topicos DEPOSITOS
ni CLIENTES_AHORRO. El parser debe esperar `404` en SBS para esos casos.

## 2. Topicos disponibles (10 carpetas 01..10)

| # | Topico | Que contiene |
|---|--------|--------------|
| 01 | EEFF | Balance General + Estado de Resultados |
| 02 | COLOCACIONES | Cartera de credito por tipo (corporativo, MYPE, consumo, hipotecario) |
| 03 | DEPOSITOS | Captaciones |
| 04 | CASTIGOS | Write-offs |
| 05 | CLIENTES_CREDITO | Numero de clientes con credito |
| 06 | CLIENTES_AHORRO | Numero de clientes con ahorro |
| 07 | OFICINAS | Apertura geografica de oficinas |
| 08 | CREDITOS_DEPOSITOS_GEO | Creditos y depositos por oficina |
| 09 | PERSONAL | Numero de personal |
| 10 | INDICADORES | Ratios regulatorios (solvencia, liquidez, calidad, rentabilidad) |

## 3. URLs y nomenclatura de archivos SBS

**Pattern definitivo:**
```
https://intranet2.sbs.gob.pe/estadistica/financiera/{anio}/{NombreMes}/{prefijo}-{codigo}-{abr}{anio}.xls
```

Ejemplo: `https://intranet2.sbs.gob.pe/estadistica/financiera/2024/Marzo/C-1101-ma2024.xls`
= Estados Financieros de TODAS las CMACs en marzo 2024.

**Prefijo:**
- `B-` para Banca Multiple y Empresas Financieras
- `C-` para CMACs, CRACs y EDPYMEs

**Mes abreviado** (mas comun): `en, fe, ma, ab, my, jn, jl, ag, se, oc, no, di`.

**Mapeo (grupo, topico) → (prefijo, codigo):**

| Topico | BANCA_MULTIPLE | FINANCIERA | CMAC | CRAC | EDPYME |
|--------|----------------|------------|------|------|--------|
| EEFF | B-2201 | B-3101 | C-1101 | C-2101 | C-4103 |
| COLOCACIONES | B-2334 | B-3220 | C-1228 | C-2228 | C-4223 |
| DEPOSITOS | B-2372 | B-3231 | C-1245 | C-2250 | — |
| CASTIGOS | B-2369 | B-3234 | C-1253 | C-2258 | C-4242 |
| CLIENTES_CREDITO | B-230803 | B-3218 | C-1231 | C-2231 | C-4226 |
| CLIENTES_AHORRO | B-2373 | B-3232 | C-1250 | C-2255 | — |
| OFICINAS | B-2303 | B-3201 | C-1201 | C-2201 | C-4205 |
| CREDITOS_DEPOSITOS_GEO | B-2358 | B-3241 | C-1234 | C-2234 | C-4228 |
| PERSONAL | B-2305 | B-3202 | C-1202 | C-2202 | C-4206 |
| INDICADORES | B-2401 | B-3301 | C-1301 | C-2301 | C-4301 |

**Total por mes:** 48 archivos (10+10+10+10+8).

## 4. Caracteristicas tecnicas de los .xls

- Formato `.xls` (Excel 97-2003 binario), **no .xlsx**.
- Usar `xlrd` o `pandas` con engine especifico.
- Cada `.xls` contiene TODAS las entidades del grupo en filas/columnas (no es
  por entidad individual). El parser debe extraer filas, una por entidad.
- Tamano tipico: 50-500 KB por archivo.
- URLs estaticas, no requieren JS rendering → no Playwright para esto.

## 5. Cuentas canonicas

**Knowledge base maestro de Gus** (fuente de verdad ANTES del scraping):

- `D:\PROYECTO\SBS\Extraer data de pagina SBS\Base de datos SBS.xlsx`
  = catalogo maestro nomenclatura SBS (codigos B-2201, B-2334, etc. + grupo +
  topico + descripciones humanas).
- `D:\PROYECTO\SBS\Extraer data de pagina SBS\CONSOLIDADO BALANCE SBS.xlsx`
  Sheet `BG` (~194 filas, plan canonico Balance General).
- `D:\PROYECTO\SBS\Extraer data de pagina SBS\CONSOLIDADO GYP SBS.xlsx`
  Sheet `ER` (~651 filas, plan canonico Estado de Resultados).
- `D:\PROYECTO\SBS\Extraer data de pagina SBS\CABECERAS DE PRINCIPALES INDICADORES SBS.xlsx`
  Sheet `CONSOLIDADO` (~200 filas, indicadores).

**Resultado final consolidado (gold standard):**
`D:\PROYECTO\SBS\BASES EXCEL\BASE EE.FF..xlsx`
- Hoja `ER` (Estado Resultados unificado)
- Hoja `BG` (Balance General unificado)
- Todas las entidades + todos los meses con cabecera canonica.

**Este archivo es el ORACULO del parser EEFF**. Cualquier divergencia entre
el parser y este archivo es un bug (no del archivo).

## 6. Reglas del plan de cuentas SBS

- **Cuentas padre** = filas en MAYUSCULAS (`DISPONIBLE`, `INVERSIONES NETAS DE
  PROVISIONES`, `TOTAL ACTIVO`).
- **Cuentas hijas** = filas en mixto debajo de un padre (`Caja`, `Bancos`).
- **El plan SBS evoluciona en el tiempo** (sheet `Hoja3` de CONSOLIDADO GYP
  tiene la version por anio 2001-2017+).
- **Para EEFF moderno (2018+)**: usar el plan mas reciente.
- **Para historico anterior**: usar la version del anio.
- **Algunos indicadores aplican solo a ciertos grupos**. Ejemplo: "Creditos
  Atrasados MN/ME" solo en BANCA, no en CMACs.

## 7. Cuentas del modelo `DW_FACT_SBSBG`

Convencion: `A<N>_NOMBRE`, `B<N>_NOMBRE`, `C<N>_NOMBRE`:
- `A1_DISPONIBLE`, `A2_FONDOS_INTERBANCARIOS`, `A3_INVERSIONES_NETAS`...
- `B<N>` = pasivos, `C<N>` = patrimonio.

Columnas fijas en los .xls SBS. Si el parser detecta filas que NO matchean
con el plan canonico, NO crear cuenta nueva — flaggear y loggear.

## 8. Periodicidad y formato

- **Periodicidad**: mensual, publicado ~30-45 dias despues del cierre.
- **Formato periodo**: `YYYYMM` (entero). Ej. `202403` = marzo 2024.
- **Profundidad historica**: desde 2010 consolidado en carpetas locales;
  SBS publica mas atras.
- **Granularidad**: entidad × mes × cuenta × moneda (PEN / USD / TOTAL).

## 9. Formulas regulatorias clave

### Anualizacion via TTM (Trailing Twelve Months)

El ER de SBS es YTD (acumulado anual desde enero). Para "anualizar":

```sql
-- Para mes != enero:
ttm(periodo) = ytd(periodo) + ytd(dic_anio_previo) - ytd(mismo_mes_anio_previo)

-- Para enero (mes = 1):
ttm(periodo) = ytd(dic_anio_previo)
```

Esto representa la suma de los 12 meses moviles que terminan en `periodo`.

**Definicion oficial en migration**:
`infrastructure/postgres/migrations/V092__kpis_anuales_dual_formula_cmac_bug.sql`

Vistas:
- `marts.v_kpis_anuales_entidad` (consolidado con nomb_correg canonico)
- `marts.v_kpis_anuales_historica` (nombre vigente del periodo)

### Promedios 12 meses (para denominadores de ROE/ROA)

```sql
activos_prom_12m = AVG(activos) over 12 ventanas mensuales previas
patrimonio_prom_12m = AVG(patrimonio) over 12 ventanas mensuales previas
```

### Indicadores comunes

| Indicador | Formula |
|-----------|---------|
| ROE | `utilidad_ttm / patrimonio_prom_12m` |
| ROA | `utilidad_ttm / activos_prom_12m` |
| Gastos Op / Margen Bruto | `(cta_10_1+10_2+10_3+10_4+12_7+12_8)_TTM / ((cta_1 - cta_2) + (cta_6 - cta_7))_TTM` |
| Cartera Atrasada | `cartera_atrasada / cartera_bruta` |
| Cobertura CAR | `provisiones / cartera_atrasada_refinanciada` |

## 10. Invariantes financieras (usar para property-based tests)

| Invariante | Donde aplica |
|------------|--------------|
| `activos == pasivos + patrimonio` | Balance, cualquier (entidad, periodo) |
| `0 <= mora <= 1` | Cualquier ratio que sea % |
| `cartera_bruta == cartera_vigente + cartera_atrasada + refinanciada` | Colocaciones |
| `periodo % 100 BETWEEN 1 AND 12` | Cualquier query con periodos |
| `cuenta_codigo en plan_canonico` | Parser EEFF — filas no canonicas son anotaciones |
| `ttm == ytd(p) + ytd(dic-1) - ytd(p-12)` cuando mes != 1 | TTM de cualquier cuenta |
| `entidades EDPYME no tienen DEPOSITOS / CLIENTES_AHORRO` | Scraper |
| `moneda IN ('MN', 'ME', 'TOTAL')` | Cualquier observacion |

## 11. Vocabulario / siglas

- SBS = Superintendencia de Banca, Seguros y AFP.
- EEFF = Estados Financieros. BG = Balance General. ER/GyP = Estado de
  Resultados / Ganancias y Perdidas.
- YTD = Year-To-Date (acumulado desde enero del anio en curso).
- TTM = Trailing Twelve Months (suma 12 meses moviles).
- RCC = Reporte Crediticio Consolidado.
- CAR = Cartera de Alto Riesgo (atrasada + refinanciada).
- Microfinanzas = subset SBS que agrupa CMACs + CRACs + EDPYMEs + financieras
  microfinancieras.

## 12. Anotaciones y footnotes a ignorar (issue #15 y #42)

Patrones de filas que NO son cuentas y deben filtrarse:

- `* texto` o `** texto` (resoluciones SBS)
- `\d+/ texto` (footnotes numeradas, ej. `1/ Incluye intereses`)
- Excel serial dates como header (`40543.0`, `42400.00`)
- Filas vacias o solo whitespace

Detector: `aibenchef_data.domains.loading.services.monthly_eeff_importer._is_annotation_or_footnote_extra`

## 13. Referencias rapidas

- Memoria proyecto: [project_data_domain](C:/Users/ASUS/.claude/projects/d--PROYECTO-SBS/memory/project_data_domain.md)
- Memoria fuentes: [reference_sbs_data_sources](C:/Users/ASUS/.claude/projects/d--PROYECTO-SBS/memory/reference_sbs_data_sources.md)
- Infra Postgres: [reference_hetzner_postgres_infra](C:/Users/ASUS/.claude/projects/d--PROYECTO-SBS/memory/reference_hetzner_postgres_infra.md)
- Testing philosophy: [`../../rules/testing-philosophy.md`](../../rules/testing-philosophy.md)
