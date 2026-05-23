# Roadmap Aibenchef — post-auditoría 2026-05-23

Estado actual y plan de implementación tras la auditoría completa y el reframe del producto.

---

## ✅ COMPLETADO en esta sesión

### 1. Auditoría completa (6 grupos de flujos)
- `docs/audits/00-RESUMEN.md` — veredicto + top 10 acciones
- `docs/audits/01-ingesta.md` — Scrape SBS + GH Action (🔴)
- `docs/audits/02-catalogo.md` — Seeds + maestra + normalize (🟡)
- `docs/audits/03-loading.md` — Importers (🟡)
- `docs/audits/04-transformacion.md` — dbt + MVs (🔴 dbt muerto)
- `docs/audits/05-apis.md` — APIs v1 (🟡)
- `docs/audits/06-frontend.md` — Frontend (🟡)

### 2. Análisis del benchmark Caja Arequipa
- PDF 45 slides analizado en detalle.
- Excel 64 sheets inspeccionado — motor de cálculo identificado.
- `docs/PRODUCT_VISION.md` — gap analysis + reframe del producto.

### 3. Fixes críticos aplicados (5)
- **F1**: Bug Análisis Dinámico al cambiar fuente — `analisis-client.tsx:47-87`.
- **F2**: Workflow YAML mensual reescrito — 5 steps explícitos en lugar de comando roto.
- **F3**: Bug runtime `listEntidades` con filtro `tipo_entidad` — `queries.ts:29-72`.
- **F4**: Auth en endpoints analytics — nuevo `auth-helpers.ts` + aplicado a 5 routes.
- **F5**: Error/loading/not-found boundaries en `/dashboard`.
- Detallado en `docs/FIXES_APLICADOS.md`.

### 4. Migraciones SQL nuevas
- **V033**: schema `config.*` (cliente, peer_group, branding, comentario_ejecutivo) + `marts.dim_kpi` (catálogo de 30 KPIs) + `marts.fact_kpis_mensuales` (long-format) + seed cliente "Caja Arequipa".
- **V034**: `marts.ttm_resultados()` (trailing 12m), `marts.cartera_promedio_12m()`, `marts.compute_kpis_punto_equilibrio(periodo)` y vista wide `marts.v_punto_equilibrio_ancho`.

### 5. Esqueleto del Dashboard Informe Ejecutivo
- Ruta nueva `/dashboard/informe` (link agregado al nav).
- `apps/web/app/dashboard/informe/page.tsx` (server).
- `apps/web/app/dashboard/informe/informe-client.tsx` (client) con 4 secciones:
  - **Header** con cliente + período + peer group + botones "Descargar PPT / PDF" (stub).
  - **Cuadro Resumen** — tabla 6 entidades × 20 KPIs en 4 grupos con ranking 1️⃣2️⃣3️⃣.
  - **Punto de Equilibrio Anualizado** — 10 componentes con `%Margen Neto` destacado.
  - **Análisis Margen Neto** — bubble chart (Recharts) + 6 mini-waterfalls + comentarios ejecutivos.
- `apps/web/app/dashboard/informe/fixture-data.ts` con TODOS los valores reales del benchmark Caja Arequipa Abr-2020 hardcoded (para validar el diseño antes de conectar a las MVs).

---

## 🟡 SIGUIENTE PASO INMEDIATO (Fase 1 del producto)

**Objetivo**: conectar el dashboard `/informe` a datos reales.

### Pasos concretos

1. **Aplicar migraciones V033 + V034** en la base productiva:
   ```bash
   cd data-platform
   uv run aibenchef db migrate
   ```

2. **Poblar `marts.fact_kpis_mensuales` para Abr-2020**:
   ```sql
   SELECT * FROM marts.compute_kpis_punto_equilibrio(202004);
   ```
   Verificar que devuelve filas para las 6 entidades del peer group. Si `cartera_promedio_12m` da NULL, revisar la columna `cta_a4` del balance.

3. **Verificar valores vs el PDF de referencia**:
   ```sql
   SELECT nomb_correg, kpi_codigo, valor
   FROM marts.fact_kpis_mensuales
   WHERE periodo = 202004
     AND nomb_correg IN ('CMAC Arequipa', 'Mibanco', 'Financiera Compartamos')
     AND kpi_codigo IN ('pe_rendimiento_cartera', 'pe_margen_neto')
   ORDER BY nomb_correg, kpi_codigo;
   ```
   Comparar contra:
   - Caja Arequipa: rendimiento 20.09%, margen neto 3.69%
   - Mibanco: rendimiento 22.76%, margen neto 4.64%
   - Compartamos: rendimiento 33.77%, margen neto 5.38%

   Si los valores difieren significativamente, revisar:
   - ¿La cuenta `cta_1_4` está bien para "rendimiento"? (`audits/04-transformacion.md` sugiere que las MVs de resultados ya están OK).
   - ¿Los valores SBS son YTD como asume `ttm_resultados`? (verificar contra `raw.eeff_observacion`).
   - ¿La cartera promedio usa la columna correcta? (`cta_a4` proxy; refinar con cartera bruta real).

4. **Conectar `page.tsx` a la BD** en lugar de la fixture:
   - Crear `apps/web/lib/domains/informe/queries.ts` con `getInformeEjecutivo(clienteSlug, periodo)`.
   - Lee de `config.cliente`, `config.peer_group`, `marts.v_punto_equilibrio_ancho`, `marts.fact_kpis_mensuales` (KPIs del cuadro resumen).
   - Modificar `page.tsx` para invocar la query en lugar de pasar la fixture.

---

## Fase 1 (resto) — Motor de KPIs (1-2 semanas)

Completar los KPIs faltantes del Cuadro Resumen:

| KPI | Cómo computarlo |
|---|---|
| `cr_n_oficinas`, `cr_n_personal`, `cr_n_clientes` | Faltan datasets: Oficinas, Personal, Clientes (no están ingeridos hoy). Ver ingesta extra. |
| `cr_part_colocaciones`, `cr_part_depositos` | Computar dividiendo cartera_entidad / suma_smf_periodo. Vista materializada. |
| `cr_cartera_bruta`, `cr_crec_cartera_bruta` | Falta dataset de Colocaciones específico. Por ahora usar cartera del balance (`cta_a4`). |
| `cr_cartera_mype` | Requiere Colocaciones por tipo. No está hoy. |
| `cr_mora_global`, `cr_cobertura_car` | Requiere reporte Mora SBS (no ingerido hoy). |
| `cr_roe`, `cr_roa`, `cr_utilidad` | Computables hoy: `cta_17` (Utilidad) anualizado / patrimonio_promedio (`cta_c`) o activos (`cta_a`). |
| `cr_gastos_op_mg_bruto` | `(cta_10 + cta_12_7 + cta_12_8) / cta_3` anualizado. |
| `cr_cartera_x_agencia`, `cr_cartera_x_empleado`, `cr_n_clientes_x_empleado` | Compuestos — dependen de los datasets faltantes. |

**Datasets que hay que ingerir además de EEFF (ver gap en PRODUCT_VISION.md)**:
- Reporte Oficinas SBS (mensual)
- Reporte Personal SBS (mensual)
- Reporte Clientes Crédito SBS (mensual)
- Reporte Colocaciones por tipo (MYPE/Consumo/Hipotecario/Empresas)
- Reporte Mora SBS

Cada uno requiere extender el scraper + parsers + tabla raw + MV/vista en marts.

---

## Fase 2 — Anexos del informe (3-4 semanas)

Replicar las 35 slides de anexos del PDF (slides 11-45) como secciones del dashboard:

### Componentes reutilizables a crear

| Componente | Slides que cubre |
|---|---|
| `<RankingPanel kpi={...}>` | Panel izquierdo de barras horizontales con ranking — usado en 25+ slides |
| `<MultiEntidadGrid kpi={...}>` | Grid 2x3 de mini-charts mensuales por competidor — usado en 25+ slides |
| `<TablaBancosImfs>` | Tablas de competidores Bancos + IMFs (slides 19, 35-38) |
| `<EstructuraCartera>` | Stacked bars MYPE/Consumo/Hipotecario/Empresas (slide 16) |
| `<MarketShareTrend>` | Stacked bars de market share por tipo (slide 17) |
| `<KpiCardSimple>` | Cards de Utilidad, ROE, ROA, etc. con sparkline (slides 32-34) |

### Secciones del dashboard a crear

Cada sección = 1 sub-ruta o 1 anchor en scroll:
- `/informe/oficinas-personal` (slides 11-12)
- `/informe/clientes` (slides 13-14)
- `/informe/cartera` (slides 15-19)
- `/informe/calidad-cartera` (slides 20-22)
- `/informe/fondeo-captaciones` (slides 23-26)
- `/informe/ingresos-margenes` (slides 27, 39-43)
- `/informe/eficiencia` (slides 28-31)
- `/informe/rentabilidad` (slides 32-34)
- `/informe/anexos-tabulares` (slides 19, 35-38, 44-45)

---

## Fase 3 — Configuración por cliente (1-2 semanas)

- **`/dashboard/admin/clientes`** (CRUD de clientes SaaS).
- **`/dashboard/admin/peer-group/[clienteSlug]`** — editor de peer group del cliente con drag & drop para orden, color picker, búsqueda de entidades.
- **`/dashboard/admin/branding/[clienteSlug]`** — upload de logo (S3/R2), color pickers.
- API endpoints `POST/PATCH /api/v1/admin/clientes`, `/peer-group`, `/branding` con `requireAdminSession`.

---

## Fase 4 — Export PPT/PDF (1-2 semanas)

**Decisión a tomar**: Opción A (server-side Python) vs Opción B (client-side pptxgenjs).

### Opción A: server-side `python-pptx`
- Servicio en `data-platform/src/aibenchef_data/report/` con FastAPI endpoint.
- Plantilla `.pptx` con placeholders (shape names) que Python rellena.
- Genera y sube a R2/S3, devuelve URL firmada.
- Pro: control total sobre layout (Python-pptx soporta tablas, charts, imágenes).
- Con: requiere mantener plantilla `.pptx` y servidor Python aparte.

### Opción B: client-side `pptxgenjs`
- Función JS en el browser que genera el PPTX desde los datos visibles.
- Pro: cero infra adicional, descarga inmediata.
- Con: harder de hacer pixel-perfect; charts de Recharts NO se exportan directo (hay que re-renderear con pptxgenjs charts).

**Recomendación**: Empezar con Opción A. Permite mantenibilidad y calidad visual sin acoplarse al estado React.

### Pasos Opción A

1. Bibliotecas: `python-pptx`, `Pillow` (para imágenes), `requests`.
2. Plantilla `data-platform/report/templates/aibenchef_v1.pptx` con shapes nombrados:
   - `{cliente_nombre}`, `{periodo_label}`, `{logo}`, `{color_primary}`
   - Tabla `cuadro_resumen_table`, tabla `punto_equilibrio_table`
   - Placeholders para chart imágenes generadas con matplotlib.
3. `data-platform/src/aibenchef_data/report/builder.py` con `build_report(cliente_id, periodo) -> bytes`.
4. Endpoint Next.js `/api/v1/informe/export?cliente=X&periodo=Y&formato=pptx` que invoca al servicio Python (gRPC, HTTP interno, o lambda).
5. Frontend: botón "Descargar PPT" en el header del informe pide el endpoint y descarga el blob.

---

## Fase 5 — Comentarios IA + Distribución (1-2 semanas)

### Comentarios ejecutivos con Claude API
- Tabla `config.comentario_ejecutivo` ya creada en V033.
- Endpoint `POST /api/v1/admin/comentarios/generar` que:
  - Recibe `(cliente_id, periodo, seccion)`.
  - Lee los datos relevantes de `fact_kpis_mensuales` (períodos previos del cliente + competidores).
  - Llama a Claude con un prompt opinado (ver `claude-api` skill — usar prompt caching para el contexto del cliente).
  - Devuelve texto sugerido. Admin lo aprueba/edita.
- Si publicado=TRUE, aparece en el dashboard.

### Distribución mensual
- GH Action que corra el día 15 (después del ingest mensual):
  1. Genera comentarios IA para todos los clientes activos.
  2. Envía email con link al dashboard (no adjunta PPT — el cliente lo descarga si quiere).

---

## Postergado / no urgente

| Item | Cuándo retomar |
|---|---|
| Conectar HttpxDownloader → `raw.archivos_descargados` directamente | Cuando el panel admin de Ingesta sea prioritario |
| Fix `withTenant` race condition | Antes de cualquier feature multi-tenant real |
| Decisión dbt: borrar o reescribir | Cuando los modelos de Fase 1 estén estables |
| Tests de integración pivot/importers/auth | Al estabilizar Fase 1 (antes de Fase 2) |
| Nav mobile en `dashboard/layout.tsx` | Cuando alguien reporte uso mobile real |
| Migrar fetches de cliente a React Query | Refactor oportunista en Fase 2 |

---

## Métricas de éxito del producto

Cuando se complete Fase 4, el sistema debería poder:

1. ✅ Mostrar el dashboard Caja Arequipa con números reales (no fixture) que coincidan ±0.5% con el PDF del cliente.
2. ✅ Generar un PPT descargable visualmente similar al original.
3. ✅ Soportar al menos 3 clientes con peer groups distintos.
4. ✅ Re-generar el informe entero en < 5 segundos.
5. ✅ Branding (logo + colores) propagado al dashboard y al PPT exportado.

Fase 5 agrega:
6. ✅ Comentarios ejecutivos automáticos con Claude (con override manual).
7. ✅ Cron mensual que avisa por email cuando hay nuevo cierre.
