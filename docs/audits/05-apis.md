# Auditoría — APIs v1 Next.js

**Estado general: 🟡 AMARILLO**

## Veredicto en 3 líneas

La arquitectura es sólida (`handleRoute` + Zod + sandbox SQL bien pensado), pero hay **3 hallazgos críticos**:
1. Los endpoints de analytics (`/pivot`, `/eeff/*`, `/entidades`) **NO requieren autenticación** — cualquiera con la URL pública accede a las MVs.
2. `withTenant()` en `db/index.ts:58` tiene **race condition** sobre pool (multi-tenant roto a futuro).
3. `listEntidades()` en `analytics/queries.ts:36` arma `$1` con `sql.raw` sin substitución → **runtime crash** si se pasa `tipo_entidad`.

Cobertura de tests: < 5% (solo 2 archivos, uno smoke-only).

---

## A. Inventario global

Auth real es **better-auth** (no Clerk). Endpoints encontrados (selección):

| Path | Métodos | Propósito |
|---|---|---|
| `/api/v1/pivot` | POST | Pivot dinámico sobre MVs EEFF |
| `/api/v1/pivot/columnas` | GET | Lista columnas disponibles por fuente |
| `/api/v1/eeff/balance` | GET | Balance long-format por entidad/periodo |
| `/api/v1/eeff/ratios` | GET | Ratios EEFF (latest o por rango) |
| `/api/v1/catalog/...` | GET | Catálogo de tablas/columnas |
| `/api/v1/sheets[/...]` | GET/POST/PATCH/DELETE | Hojas guardadas |
| `/api/v1/notebooks[/...]` | (CRUD) | Notebooks |
| `/api/v1/sql/execute` | POST | Ejecutar SELECT sandboxed |
| `/api/v1/sql/queries[/...]` | (CRUD) | Saved queries |
| `/api/v1/tableros[/...]` | (CRUD) | Dashboards |
| `/api/v1/genie/generate` | POST | NL→SQL (Aiben) |
| `/api/v1/admin/users[/...]` | GET/PATCH/DELETE | Listar/editar usuarios |
| `/api/v1/admin/invitations[/...]` | GET/POST | Invitaciones |
| `/api/v1/admin/audit` | GET | Log de auditoría |
| `/api/v1/invitations/[token]/preview` | GET | **PÚBLICO** — preview de invitación |
| `/api/v1/settings/ai-providers[/...]` | (CRUD) | Providers AI |
| `/api/v1/me` | GET/PATCH | Perfil propio |
| `/api/v1/entidades` | GET | Lista entidades |

## B. Patrones — consistencias y desvíos

- **`handleRoute` + `ValidationError`**: 100% adopción en los 30+ route.ts (`http.ts:62`).
- **Zod**: presente en TODO endpoint con body/query.
- **Respuesta `{ data, error }`**: forzada por `handleRoute`. Incluye `requestId` + `gitSha`.
- **Auth**: **inconsistente**. Patrón `auth.api.getSession({ headers })` repetido (no DRY). Los endpoints analytics (`/pivot`, `/pivot/columnas`, `/eeff/balance`, `/eeff/ratios`, `/entidades`) **no validan sesión**.
- **Naming**: snake_case en query params (`tipo_entidad`), camelCase en bodies (`tipoEntidad`).
- **Voseo argentino**: `invitations/[token]/accept/route.ts:18` usa "Tenes que..." — viola regla de tuteo peruano.

## C. Seguridad — top hallazgos

**C1 (CRÍTICO). Analytics sin auth.** `pivot/route.ts:33`, `pivot/columnas/route.ts:13`, `eeff/balance/route.ts:15`, `eeff/ratios/route.ts:18`, `entidades/route.ts:14` no llaman `auth.api.getSession()`. La data SBS es pública, sí, pero un endpoint `/api/v1/pivot` POST que pide hasta 50K filas es vector de DoS gratis.

**C2 (MEDIO). SQL injection — solo en `analytics/pivot.ts:317-319`.** El sandbox SQL (`sandbox.ts:98-136`) tiene buen whitelist + role readonly + statement_timeout. Para `runPivot`: identificadores pasan por `ident()` + whitelist; valores escapan con `''`. Es safe en práctica pero anti-patrón: deberían usar `sql` tag de drizzle.

**C3 (BAJO/MEDIO). Authorization defense-in-depth funciona.** `admin/users/[id]/route.ts:30` (PATCH) y `admin/invitations/route.ts:33` (POST) NO llaman `requireAdmin()` en el route, pero las funciones de dominio sí (`users/index.ts:137,173,193`). Seguro, pero frágil — un futuro refactor que rompa esa convención abre la puerta.

**C4 (CRÍTICO arquitectural). `withTenant` race condition.** `db/index.ts:58-64`: `set_config(...)` se ejecuta en **una** conexión del pool, luego `fn()` toma conexiones distintas. Cuando se implemente RLS multi-tenant será un **leak inmediato entre tenants**. Fix: usar `db.transaction()` + `SET LOCAL`.

## D. Performance

- **Schema cache**: `pivot.ts:73` cachea schema en `SCHEMA_CACHE: Map`. Nunca se invalida. Si se agregan columnas a la MV (cuentas nuevas), hay que reiniciar el server.
- **Pool**: `db/index.ts:27` `max: 10` + `prepare: false`. Conservador. OK para pgbouncer transaction mode.
- **N+1**: no encontré. `getBalance` (`queries.ts:172`) es JOIN single-shot.
- **`runPivot` doble query**: `getSchema` ejecuta DOS queries (`pivot.ts:100` y `109`), pero la primera (`SELECT * LIMIT 0`) es **inútil** — resultado a `rows` y nunca se usa (`void rows`). Quitar.

## E. Bugs detectables

**E1. `listEntidades()` rompe con `tipo_entidad`.** `analytics/queries.ts:36-44` arma `e.tipo_entidad = $1` dentro de `sql.raw()` — no hay binding. Si el endpoint `/api/v1/entidades?tipo_entidad=CajaMunicipal` se llama, PG lanza `42P02 parameter "$1" not present`. **Bug runtime confirmable.**

**E2. `withTenant` race condition** (descrito en C4).

**E3. `executeQuerySandbox` audit log silencioso.** `sandbox.ts:158-160` traga errores del audit log. Pérdida silenciosa de evidencia forense si el log falla.

**E4. `SCHEMA_CACHE` race en cold start.** `pivot.ts:96`: dos requests concurrentes ejecutan dos veces `getSchema()`. No corrompe data pero duplica queries.

**E5. NULL handling en `numericRowToRatio`.** `queries.ts:220`: `Number(null)` → `0`. Check `v == null` protege, pero `Number("")` también → `0`. Si la MV alguna vez retorna string vacío, ratio aparecerá como `0.0` real.

## F. Tests

Solo **2 archivos**:
- `apps/web/lib/domains/sql-workbench/sandbox.test.ts` (149 líneas) — bien cubierto.
- `apps/web/lib/domains/analytics/pivot.test.ts` (35 líneas) — **smoke test puro**. El comentario `:13-16` admite "Las llamadas a DB requieren mocks/fixtures que dejamos para un test de integracion separado." → no existen.

**Cobertura estimada**: < 5%. Cero tests sobre route handlers, cero sobre `analytics/queries.ts`, cero sobre `users/index.ts` (authz), cero sobre `invitations/accept`, cero sobre `genie`, sheets/notebooks/tableros.

## Prioridades

1. **Agregar auth a `/pivot/*`, `/eeff/*`, `/entidades`** (1 h).
2. **Fix `listEntidades` bug** (15 min) — convertir a `sql` tag.
3. **Fix `withTenant`** antes de cualquier feature multi-tenant (2 h).
4. **Helper `requireSession()` + `requireAdminSession()`** + eliminar copy-paste (2 h).
5. **Tests de integración** para pivot, analytics/queries, users/requireAdmin, invitations/accept (1-2 días).
