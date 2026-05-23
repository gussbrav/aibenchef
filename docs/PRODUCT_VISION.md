# Visión del Producto Aibenchef — basado en el benchmark real del cliente

**Fecha**: 2026-05-23
**Fuente**: `D:\PROYECTO\SBS\Benchmark\` — entregable real de Caja Arequipa (Junio 2020)
- `Benchmarking IMF's Abril 2020.pdf` (45 slides)
- `Benchmarking IMF's Abril 2020.pptx` (idem PDF)
- `Plantilla PTO EQUILIBRIO.xlsx` (27 MB, 64 sheets — motor de cálculo)

---

## El producto NO es lo que tenemos hoy

| Lo que construimos | Lo que el cliente quiere comprar |
|---|---|
| Dashboard interactivo tipo Tableau | **Informe ejecutivo mensual PPT/PDF** brandeado |
| Pivot abierto, "hagamos lo que quieras" | **Plantilla fija de 45 slides** con KPIs opinados |
| Tabla de números crudos | **Storytelling visual**: bubble charts, waterfall bps, ranking con tags 1/2/3 |
| Genérico para cualquier usuario | **Perspectiva de UNA entidad** ("mi caja") con peer-group elegido |
| Sin comentarios | **Comentarios ejecutivos** en caja azul al lado de cada slide |
| Pull (usuario explora) | **Push** (llega al correo cada mes) |

El sistema actual sirve como **back-office de exploración** (un analyst lo usaría para validar números), pero **NO es el deliverable**. El deliverable es el PPT.

---

## Estructura del deliverable (45 slides)

### Bloque 1 — Contexto (slides 1-4)

| # | Título | Contenido |
|---|---|---|
| 1 | Portada | Logo cliente + departamento + tema + fecha |
| 2-3 | Actualidad | Recortes de prensa Gestión + gráficos del sector |
| 4 | Hechos de Importancia (SMV) | Aumentos de capital, hechos materiales de competidores |

### Bloque 2 — Resumen ejecutivo (slides 5-9)

| # | Título | Contenido |
|---|---|---|
| 5 | **Cuadro Resumen** | Tabla 6 entidades x 25 KPIs en 4 secciones (Datos Generales, Cartera, Eficiencia, Rentabilidad) con ranking 1️⃣2️⃣3️⃣ |
| 6 | **Punto de Equilibrio Anualizado** | Descomposición % Rendimiento → -% Costo Fondeo → -% Provisiones → -% Op → +% Otros = % Margen Neto, con 3 períodos (Abr.20, Dic.19, Abr.19) |
| 7 | Margen Neto — bubble chart | Eje X = Punto Equilibrio (deterioro/mejora), Y = Rendimiento, tamaño burbuja = Margen Neto. Una burbuja por entidad |
| 8 | Margen Neto — waterfall Abr.20 vs Abr.19 | 6 mini-waterfalls (uno por entidad) descomponiendo el delta en bps por componente (RC, CF, CP, GO, Ot) |
| 9 | Margen Neto — waterfall Abr.20 vs Dic.19 | Idem pero contra el cierre anterior |

### Bloque 3 — Anexos por KPI (slides 10-45)

Cada slide sigue el **mismo template**:
- Header con franja azul + nombre del KPI
- Logo cliente arriba derecha
- **Panel izquierdo**: ranking con barras horizontales (6 entidades, valor actual y delta vs Dic.17)
- **Panel central**: grid 2×3 de mini-bar-charts mensuales (Dic.17, Dic.18, Abr.19, Dic.19, Abr.20) por competidor
- **Panel derecho**: comentario ejecutivo (caja azul oscuro con icono lápiz)
- Footer: "Fuente: SBS" + franja de colores

KPIs cubiertos (en orden):

| # | KPI | Cuenta SBS / Cálculo |
|---|---|---|
| 11 | N° de Oficinas | Reporte Oficinas SBS |
| 12 | N° de Personal | Reporte Personal SBS |
| 13 | N° de Clientes (Crédito) | Reporte Clientes Crédito (Miles) |
| 14 | % Clientes Exclusivos | Revista Microfinanzas COPEME |
| 15 | Cartera Bruta | Suma colocaciones, MM S/ |
| 16 | Saldo Cartera — estructura por tipo | MYPE / Consumo / Hipotecario / Empresas (% del total) |
| 17 | Market Share Cartera Colocaciones SMF | Por tipo: Total / MYPE / Consumo / Hipotecario |
| 18 | Concentración MYPE en Cartera | % MYPE / Cartera Total |
| 19 | Cartera Colocaciones — tablas | Tabla Bancos + Tabla IMFs con D.18, A.19, D.19, A.20, deltas |
| 20 | Mora Global | Indicador SBS, con y sin v/c |
| 21 | Indicadores Calidad — multi panel | Cartera Atrasada % + Alto Riesgo % + Castigos 12m % |
| 22 | Cobertura Cartera Alto Riesgo | Provisiones / CAR |
| 23 | Saldo Fondeo — estructura | Adeudos + Captaciones |
| 24 | Saldo Captaciones — estructura | DPF + Ahorros + CTS |
| 25 | Participación Cartera Depósitos en SMF | Market share por tipo de depósito |
| 26 | Costo de Fondeo | Gasto Financiero / Cartera promedio 12m |
| 27 | Rendimiento de Cartera | Ingreso Financiero / Cartera promedio 12m |
| 28 | Costo de Provisiones | ER_4 / Cartera bruta prom |
| 29-31 | Eficiencia | Gastos Op/Mg Bruto, Personal/Mg Bruto, Generales/Mg Bruto |
| 32 | Utilidad Neta anualizada | ER_17 anualizado |
| 33 | ROE | Utilidad/Patrimonio promedio |
| 34 | ROA | Utilidad/Activos promedio |
| 35-38 | Cobertura CAR — tablas Bancos + IMFs | Detalle tabular |
| 39-45 | Componentes ER absolutos (MM S/) | Ingresos Financieros, Gastos Financieros, Mg Bruto, Provisiones, Mg Neto, Gasto Personal, Gastos Generales |

---

## Motor de cálculo (Excel)

El Excel de 64 sheets opera así:

### Capa 1 — Datawarehouse en hojas `TD_*` (pegado a mano)

| Hoja | Filas | Cols | Contenido |
|---|---|---|---|
| `TD_ER` | 6,137 | 1,938 | Estado de Resultados todas entidades x meses x cuentas |
| `TD_BG` | 9,004 | 297 | Balance General |
| `TD_Colocac` | 4,691 | 182 | Colocaciones (cartera) |
| `TD_DEPOSITOS` | 200 | 183 | Captaciones |
| `TD_CASTIGOS` | 246 | 16384 | Castigos (alcanza el cap de Excel) |
| `TD_TASAS_ACTIVAS` | 2,460 | 182 | Tasas activas |
| `TD_Cobertura` | 498 | 75 | Cobertura CAR |
| `TD_Dolarizacion SF` | 5,081 | 150 | Dolarización |
| `TD_Personal` | 263 | 216 | Personal |
| `TD_Clientes_Colo` | 1,107 | 180 | Clientes crédito |
| `TD_DEPOSITOS_x Tipo` | 811 | 183 | Depósitos por tipo |

**Este es exactamente el rol que hoy cumple `marts.mv_eeff_*` y debería cumplir un set ampliado de marts.**

### Capa 2 — Motor por entidad: hojas `Variables_<Entidad>` (8 hojas idénticas)

Una por entidad del peer group ampliado: `Variables CMAQ con IFIS`, `Variables Mibanco`, `Variables CMHY`, `Variables Cusco`, `Variables Compartamos`, `Variables Piura`, `Variables Trujillo`, `Variables Sullana`. Cada una es 695 filas × 121 columnas.

**Filas (5 bloques)**:
1. Cuentas SBS raw (`ER_1_INGRESOS_FINANCIEROS`, `ER_1_4_CREDITOS_DIRECTOS`, `ER_2_GASTOS_FINANCIEROS`, `ER_4_PROVISIONES_PARA_INCOBRABILIDAD`, `ER_6_INGRESOS_SERVICIOS_FINANC`, `ER_7_GASTOS_SERVICIOS_FINANC`, `ER_8_GP_VENTA_CARTERA`, `ER_10_1_PERSONAL`, `ER_10_2_DIRECTORIO`, `ER_10_3_SERVICIOS_TERCEROS`, `ER_10_4_IMPUESTOS`, `ER_12_PROVISIONES_DEP_AMORT`, `ER_12_7_DEPRECIACION`, `ER_12_8_AMORTIZACION`, `ER_13_OTROS_ING_GASTOS`, `ER_17_UTILIDAD_NETA`)
2. Cuentas consolidadas (subsidiarias agregadas)
3. **Resultado mensual** (deltas)
4. **Resultado acumulado 12 meses** (rolling year)
5. **Resultado acumulado 3 meses** (quarterly)

**Columnas**: 121 meses encadenados (Nov 2013 → Abril 2020). El header (R3) son los números 11,12,1,2,3,...

### Capa 3 — Ratios derivados (filas 115-122 de cada Variables_*)

| Ratio | Fórmula |
|---|---|
| **Gastos Oper./Margen Financiero** (% Gastos Operacionales) | `ER_10_Acum12m / (ER_1 - ER_2 + ER_6 - ER_7)_Acum12m` |
| **Otros Ingresos (Egresos)** | `ER_13_Acum12m / Cartera prom 12m` |
| **Gastos Oper./Cartera prom (12m)** | `ER_10_Acum12m / Cartera_promedio_12m` |
| **Gastos Pers./Margen Financiero** | `ER_10_1_Acum12m / Mg_Financiero_Bruto` |
| **Gastos Gene./Margen Financiero** | `(ER_10_3 + ER_10_4)_Acum12m / Mg_Financiero` |

Y los **10 indicadores del Punto de Equilibrio** (extraídos de `P.Equil.PPT`):

```
%Rendimiento de Cartera   = (ER_1_4 anualizado) / Cartera_prom_12m
%Costo Fondeo             = -(ER_2 anualizado) / Cartera_prom_12m
%Costo Provisiones Créd.  = -(ER_4 anualizado) / Cartera_prom_12m
%Gastos Operacionales     = -(ER_10 + ER_12_7 + ER_12_8) anualizado / Cartera_prom_12m
  %Gastos de Personal     = -(ER_10_1) anualizado / Cartera_prom_12m
  %Gastos Generales       = -(ER_10_3 + ER_10_4) anualizado / Cartera_prom_12m
  %Deprec. y Amortiz.     = -(ER_12_7 + ER_12_8) anualizado / Cartera_prom_12m
%Otros Ingresos (Egresos) = +(ER_6 - ER_7 + ER_8 + ER_13) anualizado / Cartera_prom_12m
%Punto de Equilibrio      = %Costo Fondeo + %Provisiones + %Gastos Op  (es negativo)
%Margen Neto              = %Rendimiento + %Pto Equil + %Otros        (≈ ROA del negocio)
```

**Estas fórmulas son la propiedad intelectual del producto.** No están en SBS — son la opinión consultora de Caja Arequipa sobre cómo ver el negocio.

### Capa 4 — Hojas de presentación (lo que se copia al PPT)

`Cuadros Anexo`, `RESUMEN_final`, `P.Equil.PPT`, `Graficos PE Aqp con IFIS`, `Graficos PE Mibanco`, `Graf. Mora Global`, `Graf. Indicadores Final`, `Graf. Pto.Equi y Margen`, `Consolidado Resumen`...

Cada una está pre-formateada con cells exactamente del tamaño esperado por el PPT. Hoy: copy-paste manual.

---

## Catálogo de entidades (hoja `EntidadesFinancieras`)

106 entidades clasificadas con 13 columnas de atributos. Incluye flags:
- `Con IFIS` / `Sin IFIS` (incluir subsidiarias o no)
- `Con BN` / `Sin BN` (incluir Banco de la Nación)
- `Entra CSL` (sí/no para el reporte)

Esto es exactamente lo que faltaría modelar en `dw.dim_entidad`: **atributos editorial-driven** (no solo grupo SBS).

---

## Gap entre estado actual y producto deseado

### ✅ Lo que ya tenemos (reutilizable)

1. **Ingesta SBS automatizada** (semi-rota pero existe) → produce `raw.eeff_observacion`.
2. **Plan de cuentas canónico** en `dw.dim_cuenta` con códigos `A1.1`, `R.1.4`, etc.
3. **MVs ancho de Balance y Resultados** (`marts.mv_eeff_balance_ancho`, `marts.mv_eeff_resultados_ancho`) — equivalen a la capa 1 del Excel (`TD_BG`, `TD_ER`).
4. **86 entidades** ya cargadas en `dw.dim_entidad`.
5. **MV de ratios** (`marts.mv_eeff_ratios`) — incipiente, faltan los 10 indicadores del Punto de Equilibrio.
6. **Frontend con auth, dashboard, AG Grid, Recharts** — la infra del informe ejecutivo.
7. **Generador de informes**: NO está, pero hay `notebooks` y `tableros` que sirven de base UI.

### ❌ Lo que falta construir (en orden de criticidad)

#### Capa 1 — Datos faltantes

1. **Ingestar fuentes extras** que el PDF usa:
   - Colocaciones por tipo (MYPE/Consumo/Hipotecario/Empresas) — hoy NO está.
   - Clientes Crédito (Miles) — hoy NO está.
   - Clientes Exclusivos (Revista Microfinanzas COPEME) — fuente NO SBS, mensual.
   - Cobertura CAR — hoy NO está.
   - N° de Oficinas + N° de Personal — hoy NO está.
   - Castigos 12 meses — hoy NO está.
2. **Métrica `cartera_promedio_12m`** (denominador de varios ratios) — requiere ventana móvil 12 meses.

#### Capa 2 — Motor de cálculo

3. **Migración SQL**: crear `marts.fact_kpis_mensuales(periodo, entidad_id, kpi_codigo, valor)` long-format.
4. **dbt models** (uno por KPI o agrupados por familia):
   - `marts.kpi_rendimiento_cartera`
   - `marts.kpi_costo_fondeo`
   - `marts.kpi_costo_provisiones`
   - `marts.kpi_gastos_op` + sub-componentes
   - `marts.kpi_otros_ing_egr`
   - `marts.kpi_punto_equilibrio` (calculado)
   - `marts.kpi_margen_neto` (calculado)
   - `marts.kpi_mora_global`, `mora_atrasada`, `cobertura_car`, `market_share_*`, etc.
5. **Tests dbt** para cada KPI: not_null, accepted_range, asserts contra Excel.

#### Capa 3 — Configuración de informe

6. **Tabla `config.reporte_template`** con la definición del informe estándar (45 slides, KPIs, comparativos).
7. **Tabla `config.peer_group(cliente_id, entidad_propia, competidores[], con_ifis bool, con_bn bool)`** — cada cliente define su peer group.
8. **Tabla `config.cliente_branding(cliente_id, logo_url, color_primary, color_secondary, nombre_short)`** — para brandear los slides.

#### Capa 4 — Generador

9. **Servicio `report-generator`** (Python o Node):
   - Input: `(cliente_id, periodo)`
   - Output: archivo .pptx (o .pdf renderizado) + URL en R2/S3
   - Stack candidato: **python-pptx** sobre un template `.pptx` con placeholders. O **react-pdf** si vamos por HTML→PDF.
   - Resuelve datos llamando a `marts.fact_kpis_mensuales`.
   - Inyecta logo + colores del cliente.
   - Comentarios ejecutivos: **opcional con Claude API** (input = números del mes vs períodos previos + serie histórica del cliente → texto de 2-3 líneas opinado).

#### Capa 5 — UI

10. **`/dashboard/reportes`** — lista de reportes generados con preview thumbnail + botón "Descargar PPT/PDF" + botón "Re-generar".
11. **`/dashboard/admin/peer-group`** — editor del peer group del cliente.
12. **`/dashboard/admin/branding`** — upload de logo + paleta.
13. **`/dashboard/admin/comentarios`** — edición manual de los comentarios ejecutivos antes de generar (override de los generados por IA).

#### Capa 6 — Distribución

14. **GH Action / cron mensual** que dispare `report-generator` para todos los clientes activos cuando SBS publique el cierre y enviarlos por correo.

---

## Cuál es el camino más corto al MVP comercializable

Propuesta de **fases** (ordenadas para entregar valor rápido):

### Fase 0 — Arreglar lo roto (1-2 días)
Es prerequisito. Ver `audits/00-RESUMEN.md`. Fixes críticos: workflow YAML, auth analytics, dbt path, error.tsx, listEntidades bug.

### Fase 1 — Punto de Equilibrio en la UI actual (1 semana)
Sin generar PPT todavía. Solo: implementar los 10 KPIs de Punto de Equilibrio en marts + crear una página `/dashboard/punto-equilibrio` que muestre la tabla del slide 6 + el bubble chart del slide 7 + los waterfalls del slide 8. **Es la pieza de IP del producto.** Esto YA convierte el producto en "diferente a Tableau".

### Fase 2 — Cuadro Resumen + KPIs anexos (2-3 semanas)
Implementar los KPIs faltantes (slides 11-34). Cada KPI = 1 modelo dbt + un componente React reusable (`<KpiRankingPanel kpi="mora_global" />`).

### Fase 3 — Generador de PPT (2-3 semanas)
Servicio `report-generator` con `python-pptx`. Template hardcodeado primero. Genera para un solo cliente (Caja Arequipa) con sus colores fijos.

### Fase 4 — Multi-tenant + branding (1-2 semanas)
`config.cliente_branding`, `config.peer_group`. Generador parametrizado.

### Fase 5 — Comentarios IA + distribución (1-2 semanas)
Claude API para comentarios ejecutivos. Cron mensual + email.

**Total estimado MVP: ~10 semanas.**

---

## Decisión arquitectural pendiente

> ¿El `Análisis Dinámico` actual sigue siendo parte del producto o se discontinúa?

**Recomendación**: mantenerlo como herramienta interna/analyst, pero NO promocionarlo en el sales pitch. El producto vendible es el informe. El pivot interactivo es "el backstage que mostramos a clientes que pidan más profundidad".

---

## Decisión tomada por Gus (2026-05-23)

> **El contenido del PPT es lo más vendible. Va dentro de un dashboard interactivo. El PPT en sí (archivo descargable) es un add-on.**

Esto cambia la arquitectura de forma significativa:

### Lo que NO vamos a hacer

- ❌ Construir un servicio Python `report-generator` que produzca .pptx como output principal.
- ❌ Considerar el archivo PPT como el deliverable canónico.
- ❌ Push automático mensual del PPT por correo (al menos no como vector principal).

### Lo que SÍ vamos a hacer

- ✅ Construir una **página/sección del dashboard "Informe Ejecutivo"** que replique las 45 secciones del PPT pero como UI web navegable e interactiva.
- ✅ Sub-rutas o scroll continuo con todas las secciones (Cuadro Resumen, Punto de Equilibrio, Anexos por KPI).
- ✅ **Interactividad** que el PPT no tiene: cambiar período, cambiar peer group, drill-down a series mensuales, toggles "Con/Sin IFIS".
- ✅ **Botón "Descargar PPT"** como add-on: toma el estado actual de la pantalla y genera un PPTX descargable.
- ✅ **Botón "Descargar PDF"** equivalente para clientes que prefieren ese formato.

### Arquitectura simplificada

| Capa | Solución |
|---|---|
| Motor de KPIs | dbt models + `marts.fact_kpis_mensuales` (igual que antes) |
| UI principal | Nueva ruta `/dashboard/informe` (o `/benchmark`) en el mismo Next.js |
| Componentes reusables | `<RankingPanel>`, `<MultiEntidadGrid>`, `<ComentarioEjecutivo>`, `<WaterfallBps>`, `<BubbleChart>`, `<CuadroResumen>` |
| Export PPT (add-on) | Opción A: **server-side Python** con `python-pptx` sobre template `.pptx`. Opción B: **client-side** con `pptxgenjs` (no requiere backend, descarga directa). |
| Export PDF (add-on) | `@react-pdf/renderer` server-side, o `print to PDF` del browser sobre layout print-friendly |
| Branding por cliente | Tabla `config.cliente_branding` aplicada al dashboard Y al PPT exportado |

### Roadmap revisado (8-10 semanas total)

**Fase 0 — Fixes críticos (1-2 días)** ✅ **COMPLETADA** en esta sesión.

**Fase 1 — Motor de KPIs Punto de Equilibrio (1-2 semanas)**
- Migración SQL: `marts.fact_kpis_mensuales(periodo, entidad_id, kpi_codigo, valor)`.
- dbt models para los 10 KPIs del Punto de Equilibrio (Rendimiento Cartera, Costo Fondeo, Provisiones, Gastos Op, Otros).
- KPIs del Cuadro Resumen (Mora Global, Cobertura CAR, Crec. Cartera, ROE, ROA, etc.).
- Tests dbt: assert los valores vs Excel (al menos 5 periodos de Caja Arequipa).

**Fase 2 — Dashboard "Informe Ejecutivo" (3-4 semanas)**
- Nueva ruta `/dashboard/informe/[clienteSlug]` (default = cliente del usuario logueado).
- Layout: hero con selector de período + peer group, luego scroll continuo o tabs por sección.
- Componentes reutilizables (~6 building blocks).
- Replica visual del PPT: paleta correcta (verde Compartamos, azul oscuro CMAC AQP, etc.), franjas de color, tipografía.
- Comentarios ejecutivos: por ahora **estáticos** (texto editable manual por admin).

**Fase 3 — Configuración por cliente (1-2 semanas)**
- Tabla `config.cliente`: id, slug, nombre_corto, entidad_propia_nomb_correg.
- Tabla `config.peer_group`: cliente_id, competidor_nomb_correg, orden, color_hex.
- Tabla `config.cliente_branding`: cliente_id, logo_url, color_primary, color_secondary.
- UI admin para editar peer group + branding.
- El dashboard aplica branding del cliente: logo en el header, colores en las series.

**Fase 4 — Add-ons: descargas PPT y PDF (1-2 semanas)**
- Decisión Opción A vs B (ver C.UA).
- Plantilla `.pptx` con placeholders (si Opción A) o helpers `pptxgenjs` (si Opción B).
- Mapeo 1:1 secciones-del-dashboard → slides-del-pptx.
- Botón "Descargar PPT" en el header del informe.

**Fase 5 — Comentarios IA + cadencia (1-2 semanas)**
- Endpoint Claude que genera comentarios ejecutivos por sección dado el contexto numérico.
- Admin puede aprobar/editar antes de marcarlos "publicados".
- Newsletter mensual con preview + link al dashboard (no adjunta PPT — el cliente lo descarga si quiere).

### Tradeoff de la opción dashboard-first vs PPT-first

| Dimensión | Dashboard-first (elegida) | PPT-first |
|---|---|---|
| Time-to-market | Más rápido (no requiere infra Python aparte) | Más lento |
| Interactividad | Alta — el cliente puede explorar | Cero |
| Mobile | Funciona si responsive | PPT en mobile es horrible |
| Onboarding cliente | Login + ver inmediatamente | Hay que generar y enviar |
| Demanda de bandwidth | Bajo (HTML) | Alto (PPT 4-5MB cada mes) |
| Veneración tradicional bancaria | El comité directivo aún quiere PPT en pantalla | Esto es por qué el add-on existe |
| Mantenibilidad de templates | Componentes React versionados | Template .pptx versionado a mano |
| Personalización por cliente | Branding aplicado en runtime | Branding aplicado al generar |

El add-on PPT cierra el gap del último punto (comité directivo): "yo lo veo en la web pero le mando el PPT al directorio el lunes".

---

## Anexo — Mapeo cuentas SBS → fórmulas del PPT

Los códigos `ER_X_Y_Z` del Excel corresponden 1:1 con los códigos canónicos del plan SBS que ya tenemos en `seeds/cuentas_resultados.json`. Conversión:

| Excel | Canónico nuestro | Nombre |
|---|---|---|
| `ER_1_INGRESOS_FINANCIEROS` | `1` | Ingresos Financieros |
| `ER_1_4_CREDITOS_DIRECTOS` | `1.4` | Créditos Directos |
| `ER_2_GASTOS_FINANCIEROS` | `2` | Gastos Financieros |
| `ER_4_PROVISIONES_PARA_INCOBRABILIDAD_DE_CREDITOS` | `4` | Provisiones para Incobrabilidad |
| `ER_6_INGRESOS_POR_SERVICIOS_FINANCIEROS` | `6` | Ingresos por Servicios Financieros |
| `ER_7_GASTOS_POR_SERVICIOS_FINANCIEROS` | `7` | Gastos por Servicios Financieros |
| `ER_10_GASTOS_ADMINISTRATIVOS` | `10` | Gastos Administrativos |
| `ER_10_1_PERSONAL` | `10.1` | Personal |
| `ER_10_3_SERVICIOS_RECIBIDOS_DE_TERCEROS` | `10.3` | Servicios Recibidos de Terceros |
| `ER_12_PROVISIONES_DEPRECIACION_Y_AMORTIZACION` | `12` | Provisiones, Depreciación y Amortización |
| `ER_13_OTROS_INGRESOS_Y_GASTOS` | `13` | Otros Ingresos y Gastos |
| `ER_17_UTILIDAD_PERDIDA_NETA` | `17` | Utilidad / Pérdida Neta |

Todos están en nuestro catálogo. Solo falta computar las fórmulas.
