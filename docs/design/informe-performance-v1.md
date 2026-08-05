# Design Doc — Informe Performance V1

**Estado**: SHIPPED — production 2026-08-05 (commits 00775d6 → 3d45012)
**Autor**: gussbrav (con Claude)
**Ambito**: `/dashboard/informe` (Benchmark Ejecutivo)

---

## 1. Problema

El `/dashboard/informe` renderizaba en **~10 segundos** wall-clock. Durante
ese tiempo el usuario veia un spinner blanco generico. UX percibida:
"aplicacion rota". Ademas, cuando el contenido finalmente cargaba, habia
un **parpadeo visible** por layout shift (contenido saltaba
horizontal + vertical al reemplazar al fallback).

Feedback textual del usuario: "esto da la sensacion que no algo va mal
podrias mejorar la experiencia o mejorar el rendimiento?".

## 2. Diagnostico

### 2.1 Herramientas usadas

- **`/api/health?deep=1`**: expone `git_sha`, `uptime_seconds`,
  `migrations.detail` y latencia por check. Ya existente antes del
  proyecto, sirvio para confirmar que el problema no era deploy stale.
- **`/api/v1/admin/debug/apply-pending-migrations`** (creado en el proceso):
  aplica migraciones on-demand y devuelve el error de Postgres exacto
  cuando el migrator falla en silencio. Se mantiene como herramienta
  permanente.
- **subagent Explore de Claude Code**: analisis profundo del
  `getInformeData` (2229 lineas) que devolvio mapa priorizado de
  bottlenecks con line-numbers y estimacion cualitativa de impacto.

### 2.2 Bottlenecks encontrados

Ordenados por impacto esperado:

1. **Megaquery `getCuadroResumenRaw`** (queries.ts:450) — 14 CTEs con 12
   LEFT JOINs escaneaban las ~120 entidades del sistema completo para
   despues quedarse con las ~10 del peer group. `resolver_nomb_correg_
   canonico()` se llamaba ~1680 veces por request (120 × 14).
2. **5 awaits seriales pre-Promise.all** (queries.ts:1107-1169) —
   `getClienteBySlug`, `getNombreLargoEntidad`, `getTop2PorGrupoByCartera`,
   `aplicarReglaPeerDefault`, `buildCompetidores` corrian en cadena
   secuencial cuando algunas eran independientes.
3. **Sin cache de queries auxiliares** — `listPeriodosDisponibles`,
   `listEntidadesDisponibles`, `getUltimoPeriodoPublicable`,
   `getPeriodoCompletenessStatus` corrian frescas en cada request
   aunque cambien ~1 vez por mes / dia.
4. **Sin cache del resultado completo** — el mismo `(cliente, periodo,
   peer group)` ejecutaba las mismas 5+ queries pesadas en cada visita
   y por cada usuario, aunque el underlying data cambia solo con la
   ingesta SBS (3x/dia).

### 2.3 Bug secundario: parpadeo al aparecer el contenido

3 causas independientes de layout shift:

- `animate-premium-in` con `translateY(4px)→0` — salto vertical.
- `loading.tsx` en `max-w-[1400px]` mientras `InformeClient` real en
  `max-w-7xl` (1280px) — salto lateral de ~120px.
- `loading.tsx` con selectores en layout distinto al `SelectoresToolbar`
  real (padding, gap, orientacion) — mini-reflow.

## 3. Solucion

### 3.1 Optimizacion de queries (queries.ts)

**Fase 1 — Paralelizar awaits iniciales** (`getInformeData`)

Reemplazo el pipeline serial por un `Promise.all` con branching upfront:

```ts
const needsNombreLargo = !!opts.entidadPropiaOverride;
const needsTopPorGrupo = !opts.peerGroupOverride?.length;
const [clienteBase, nombreLargoOverride, peerListDefault] = await Promise.all([
  getClienteBySlug(opts.clienteSlug),
  needsNombreLargo ? getNombreLargoEntidad(opts.entidadPropiaOverride!) : Promise.resolve(null),
  needsTopPorGrupo ? getTop2PorGrupoByCartera(opts.periodo) : Promise.resolve(null),
]);
```

Las dependencias reales (`aplicarReglaPeerDefault`, `buildCompetidores`)
siguen despues porque necesitan `cliente` + `peerList` resueltos.

**Fase 2 — Pre-filtrar CTEs por peer group** (`getCuadroResumenRaw`)

Se agrego una CTE `raw_names` que expande los ~10 canonicos del peer group
a la lista completa de aliases raw via `dw.entidad_maestra` + `entidad_nombre`:

```sql
raw_names AS (
  SELECT DISTINCT en.nombre AS name
  FROM input i
  JOIN dw.entidad_maestra em ON em.nomb_correg_canonico = i.canon
  JOIN dw.entidad_nombre en  ON en.entidad_id = em.id
  WHERE en.consolidar = TRUE
)
```

Cada uno de los 3 CTEs sobre MVs raw (`bg_actual`, `bg_prev`, `er_anual`)
agrega:
```sql
AND nomb_correg IN (SELECT name FROM raw_names)
```

Los 11 CTEs sobre vistas ya-canonizadas (`oficinas`, `clientes`, etc.)
filtran directo con la lista `canon`:
```sql
AND nomb_correg IN (SELECT canon FROM input WHERE canon IS NOT NULL)
```

Con los indices existentes en `(periodo, nomb_correg, moneda)` el planner
hace nested-loop join sobre 10 filas en lugar de seq-scan sobre 120.

### 3.2 Cache aggressive (page.tsx)

Patron "Vercel dashboard / Linear / GitHub" — cachear TODO el resultado
de `getInformeData` con `unstable_cache` de Next.js:

```ts
async function getInformeDataCached(opts: CacheableInformeOpts) {
  const key = JSON.stringify({
    c: opts.clienteSlug,
    p: opts.periodo,
    pg: opts.peerGroupOverride ?? null,
    e: opts.entidadPropiaOverride ?? null,
    t: opts.temaOverride ?? null,
    o: opts.ordenOverride ?? null,
    cs: opts.consolidar,
    co: opts.colorsOverride
      ? [...opts.colorsOverride.entries()].sort()
      : null,
  });
  return unstable_cache(
    () => getInformeData(opts),
    ["informe:data", key],
    {
      revalidate: 1800,
      tags: [
        "informe",
        `informe:periodo:${opts.periodo}`,
        `informe:cliente:${opts.clienteSlug}`,
      ],
    },
  )();
}
```

**Decision clave**: `colorsOverride` va en la key (no post-cache) porque
el color se propaga desde `data.competidores` hacia
`data.historicoEntidad[i].color` y series de charts. Aplicar el override
post-cache dejaba inconsistencia visual (chips con color nuevo, graficos
con color viejo). Trade-off: usuario que customiza colores genera entrada
de cache propia. Es raro y las entradas son pequeñas.

Las 4 queries auxiliares del `page.tsx` tambien fueron cacheadas:

| Query | Revalidate | Tag |
|---|---|---|
| `listPeriodosDisponibles({ ultimosN: 240 })` | 600s | `periodos` |
| `listEntidadesDisponibles({})` | 600s | `entidades` |
| `getUltimoPeriodoPublicable()` | 1800s | `periodos` |
| `getPeriodoCompletenessStatus(periodo)` | 1800s | `periodos`, `completeness:${periodo}` |
| `getInformeData(opts)` | 1800s | `informe`, `informe:periodo:X`, `informe:cliente:Y` |

### 3.3 Invalidacion automatica

Modificacion en `POST /api/v1/admin/refresh-mvs`:

```ts
await db.execute(sql`SELECT ... FROM marts.refresh_mvs_informe()`);
// Post-refresh: invalidar caches del informe
revalidateTag("informe");
revalidateTag("periodos");
revalidateTag("entidades");
```

Sin esto, tras la ingesta SBS el usuario veria data vieja hasta expirar
el `revalidate` de 30min. Con esto, la data se refresca al instante.
Response incluye `cachesInvalidated: [...]` para observabilidad.

### 3.4 UX de loading

Evolucion:

1. **v0** (heredado): spinner blanco generico `"Cargando…"` durante 10s.
2. **v1** (`loading.tsx` + `loading-hint.tsx`): skeleton con shimmer sweep,
   contenido estatico real (iconos, titulos, labels), hint rotante
   ("Resolviendo peer group SBS…", "Calculando ratios…").
3. **v2** (removido): con el cache aggressive la mayoria de visitas son
   cache-hit (~100ms). El skeleton aparecia por milisegundos antes de
   ser reemplazado → se percibia como flicker.

**Solucion final** — sin skeleton. Un solo indicador continuo de carga:

- **`TopProgressBar`** global (dashboard/top-progress-bar.tsx): barra
  brand fija al top del viewport, activada en cada navegacion interna.
  Progresion exponencial hacia 90%, completa a 100% cuando Next termina
  la navegacion. Con drop-shadow glow + peek con blur al filo derecho.
  Signature move de apps premium (YouTube, Vercel, Linear).
- **`animate-premium-in`** (globals.css): fade puro 240ms `ease-out`
  al montar el `InformeClient`. Solo opacity — no transform — para
  evitar el layout shift vertical.
- **Vista anterior visible durante fetch**: Next.js App Router mantiene
  el HTML previo mientras el server component nuevo se resuelve. No hay
  "pantalla vacia" incluso en cache miss.

## 4. Impacto

**Wall-clock de renderizado del `/dashboard/informe`**:

| Escenario | Antes | Despues |
|---|---|---|
| Primera visita (cache miss) | ~10s | ~5s |
| Segunda visita mismo `(cliente, periodo, peers)` | ~10s | **<100ms** |
| Distintos usuarios, mismo periodo | ~10s c/u | ~5s primero, <100ms resto |
| Post-refresh MVs (invalidado) | ~10s | ~5s (fresh) |

**UX percibida**: cero "app rota". El usuario ve feedback instantaneo
(barra brand arriba) desde el frame del click.

## 5. Playbook — replicar el patron en otras rutas

Para aplicar la misma optimizacion a otras rutas pesadas del dashboard
(`/analisis`, `/eeff`, futuros dashboards), seguir estos 4 pasos:

1. **Identificar bottlenecks** con subagent Explore o SQL profiling:
   ```
   subagent Explore, prompt: "Analiza profundamente <funcion>. Reporta:
     serial awaits fixables con Promise.all, N+1 candidates, queries
     pesadas con line-numbers, top 3 fixes sugeridos con impacto."
   ```
2. **Paralelizar awaits independientes** con `Promise.all` + branching
   upfront (necesitas conocer las dependencias reales).
3. **Cachear queries individuales** con `unstable_cache(fn, [key],
   { revalidate, tags })`. Frecuencia sugerida:
   - Data que cambia por ingesta: `revalidate: 1800` (30 min)
   - Data casi estatica (config): `revalidate: 3600` (1 hora)
   - Tags jerarquicos: `["dominio", "dominio:tipo:${valor}"]`
4. **Cachear el resultado completo** de la funcion de fetch principal
   con key que incluya TODOS los params que afectan output.
5. **Invalidar en el hook correcto** (endpoint admin de refresh, cron
   post-ingest, webhook, etc.) con `revalidateTag(...)`.

## 6. Mantenimiento

### 6.1 Invalidacion manual

Todos los tags disponibles:

- `informe` — reset completo del dominio informe.
- `informe:periodo:${N}` — invalidar solo un periodo (util cuando entra
  data nueva para ese mes).
- `informe:cliente:${slug}` — invalidar solo un cliente (config edit).
- `periodos` — invalidar `listPeriodosDisponibles` + `getUltimoPeriodo`
  + `getPeriodoCompletenessStatus`.
- `entidades` — invalidar `listEntidadesDisponibles`.
- `completeness:${N}` — invalidar completeness de un periodo especifico.

Endpoints existentes que invalidan:

- `POST /api/v1/admin/refresh-mvs` → `informe` + `periodos` + `entidades`.

Para invalidar manualmente sin refresh de MVs, crear un endpoint admin
que llame `revalidateTag(...)`. No existe todavia — agregar cuando haga
falta.

### 6.2 Diagnostico

Si aparece "data vieja" en produccion:

1. Verificar SHA desplegado: `curl /api/health` → `git_sha`.
2. Verificar migraciones aplicadas: `curl /api/health?deep=1` →
   `migrations.detail`.
3. Verificar cache-freshness: comparar `data.timestampGeneracion` (si
   existe) contra `now()`.
4. Invalidar manualmente con `POST /api/v1/admin/refresh-mvs`.

Si el migrator falla silenciosamente:

1. El CMD del Dockerfile usa `||` no `&&` — la app arranca aunque el
   migrator falle (fail-forward con visibility).
2. `curl /api/health?deep=1` muestra `migrations.detail: "N aplicadas,
   ultima=VX"` — si X < ultima migration en repo, migrator fallo.
3. Correr `POST /api/v1/admin/debug/apply-pending-migrations` (admin)
   para obtener el error de Postgres exacto con `errorCode`,
   `errorPosition`, `errorHint`.

### 6.3 Testing del cache

Verificar cache hit despues de deploy:

```bash
# Primer request — cache miss, ~5s
time curl -s https://aibenchef.azoramind.com/dashboard/informe > /dev/null

# Segundo request — cache hit, <100ms
time curl -s https://aibenchef.azoramind.com/dashboard/informe > /dev/null
```

Si el segundo NO es <100ms, revisar:
- Que `dynamic = "force-dynamic"` no este bypaseando el cache.
- Que `unstable_cache` este siendo llamado correctamente.
- Que los `tags` no esten siendo invalidados por otro proceso.

## 7. Riesgos y limitaciones

- **`unstable_cache` es unstable** (nombre literal de la API). Next.js
  puede cambiar la signature en versiones futuras. Ubicado en un solo
  archivo (`page.tsx`) para facilitar migracion cuando salga
  `use cache` estable.
- **Cache es por-contenedor** (filesystem). Deploy nuevo = cache reset
  (primera request paga los 5s). Aceptable para deploys ~diarios.
- **Sin cache warming**: no hay job que pre-popule el cache post-deploy.
  Si es critico para UX en el primer usuario post-deploy, agregar un
  cron que golpee las URLs mas comunes despues de cada rebuild.
- **`consolidar=false` no aplica pre-filter en MVs raw**: la
  optimizacion de `raw_names` solo cubre el 99% de casos
  (`consolidar=true` default). Cuando `?consolidar=false` viene en URL,
  las MVs raw hacen seq-scan igual que antes.

## 8. Referencias

- Commits del proyecto:
  - `00775d6` — perf(informe): 3 optimizaciones profundas
  - `92971a1` — perf+fix(informe): eliminar flicker + cache adicional
  - `4866458` — perf(informe): cache aggressive del resultado completo
  - `3d45012` — revert(informe): quitar skeleton loading
- Archivos tocados:
  - `apps/web/lib/domains/informe/queries.ts` (paralelizacion + pre-filter)
  - `apps/web/app/dashboard/informe/page.tsx` (cache aggressive)
  - `apps/web/app/api/v1/admin/refresh-mvs/route.ts` (invalidacion)
  - `apps/web/app/api/v1/admin/debug/apply-pending-migrations/route.ts` (diag)
  - `apps/web/app/dashboard/top-progress-bar.tsx` (UX signature)
  - `apps/web/app/globals.css` (animate-premium-in + shimmer)
- Docs relacionados:
  - `docs/design/pipeline-observability-v1.md` — la ingesta SBS que
    dispara `revalidateTag`.
