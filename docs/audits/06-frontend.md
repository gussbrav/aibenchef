# Auditoría — Frontend (`apps/web/`)

**Estado general: 🟡 AMARILLO con tendencia a VERDE**

La arquitectura App Router está bien aplicada (RSC por defecto, `"use client"` solo donde corresponde, auth uniforme en el layout). Tres dolores principales:

1. **Cero loading/error/not-found boundaries** en toda la app: ninguna ruta tiene `loading.tsx`/`error.tsx`/`not-found.tsx` — un throw en cualquier server-fetch rompe el dashboard entero.
2. **Cero tests frontend** (solo dos `*.test.ts` de dominio backend en `lib/domains/`). No hay Playwright/Cypress ni vitest de componentes.
3. **React Query instalado pero no usado**: todo cliente hace `fetch` plano + `useState` + `useEffect`, con duplicación, sin caché, sin dedup y con varios efectos sin guard de "alive".

---

## A. Inventario de páginas

| Ruta | Propósito | Estado |
|---|---|---|
| `/dashboard` | KPIs + tabla entidades último cierre | OK |
| `/dashboard/eeff` | EEFF por entidad con histórico/charts | OK |
| `/dashboard/analisis` | Pivot interactivo AG Grid + charts + workspaces | OK (fix reciente) |
| `/dashboard/tableros[/id]` | Dashboards multi-widget | OK |
| `/dashboard/sheets[/id]` | Editor tipo Excel | OK |
| `/dashboard/notebooks[/id]` | Editor SQL + markdown + charts | OK |
| `/dashboard/sql` | SQL libre con Monaco + AG Grid | OK |
| `/dashboard/catalog` | Catálogo de tablas/columnas | OK |
| `/dashboard/aiben` | NL→SQL con Claude/Ollama | OK |
| `/dashboard/admin/archivos` | Inventario archivos SBS | OK |
| `/dashboard/settings` | Tabs perfil/AI/users/invites/audit/debug | OK |
| `/login`, `/signup`, `/waitlist` | Better Auth | OK |

**Auth**: Better Auth. Layout `dashboard/layout.tsx:17` hace `auth.api.getSession()` y redirige a `/login`.

## B. Patrones App Router

- **Server vs Client bien separado**: 17 archivos con `"use client"`, todos en sub-componentes; los `page.tsx` del dashboard son RSC y delegan a un `*-client.tsx` (patrón consistente).
- **`export const dynamic = "force-dynamic"`** consistente en TODOS los `page.tsx` (cookies + sesión).
- **`metadata`** declarada en cada page.tsx.
- **Falta crítico**: cero `loading.tsx`, cero `error.tsx`, cero `not-found.tsx`. Los `[id]/page.tsx` llaman `notFound()` (`tableros/[id]/page.tsx:24`, `notebooks/[id]/page.tsx:23`, `sheets/[id]/page.tsx:23`) pero no hay `not-found.tsx` que lo renderice — usa el default global. Ante un error de DB en `page.tsx` (ej. `getRatiosLatest`) la página revienta sin fallback.
- **Estilo**: 100% Tailwind, sin shadcn instalado (a pesar del contexto). UI propio en `components/ui/` (Button, Card, Container, etc.).

## C. Estado y data fetching

- **Patrón mixto OK**: listings y reads en `page.tsx` server-side via funciones de `lib/domains/`. Acciones interactivas (pivot, sql, aiben, settings) en client con `fetch()` a `/api/v1/*`.
- **React Query instalado** (`package.json:31`) pero **no usado** — sólo `widget-renderer.tsx:1` lo importa. El resto del frontend reinventa loading/error/dedup con `useState`+`useEffect`.
- **`AbortController` no se usa en ningún cliente** — race conditions posibles. `analisis-client.tsx:53-91` mitiga con flag `alive` (bueno); `settings/users-section.tsx`, `aiben-client.tsx`, `command-palette.tsx` no.

## D. Accesibilidad / UX

- **ARIA pobre**: solo 22 ocurrencias de `aria-*`/`role=` en TODO el dashboard. Los muchos `<button>` icon-only (header de analisis, formato menu, command palette triggers) carecen de `aria-label`.
- **Mobile responsive**: 21 archivos con prefijos `sm:/md:/lg:` — pero el dashboard layout esconde la nav en mobile (`layout.tsx:39` `hidden md:flex`) **sin reemplazo de menú hamburguesa** — en mobile el usuario solo ve logo + command palette + user menu. **La nav del dashboard es inaccesible en mobile**.
- **Empty states**: bien cubiertos.

## E. Bugs detectables

- **`command-palette.tsx:166`**: `useMemo` deps array omite `sheetItems` — el listado de "Sheets" en el palette **no se actualiza** cuando llegan los datos. Bug real.
- **`command-palette.tsx:97-114`**: `Promise.all` no chequea unmount — si el palette se cierra rápido, setStates corren igual.
- **`settings-client.tsx:37-44`**: fetch `/api/v1/me` sin cleanup ni alive flag — leak menor.
- **`aiben-client.tsx:127-129`**: rollback del último mensaje con `c.slice(0, -1)`; dos requests concurrentes haría que el segundo rollback elimine el del primero.
- **`analisis-client.tsx`**: fix reciente al cambio de fuente OK — limpieza de resultado + poda de medidas inválidas, cleanup con `alive` correcto.

## F. Tests

- **Frontend: 0 tests**. Glob `**/*.test.tsx` no devuelve nada.
- **Backend en `apps/web/lib/domains/`**: 2 tests. Vitest configurado.
- **E2E**: no hay Playwright ni Cypress.

## Bibliotecas en uso

- **AG Grid v32** community: `analisis-client.tsx:4`, `sql-workbench-client.tsx:4`, `sheets/[id]/sheet-editor.tsx`, `widget-renderer.tsx`.
- **Recharts**: `eeff/trend-chart.tsx`, `analisis/chart-panel.tsx`, `widget-renderer.tsx`.
- **@monaco-editor/react**: en `components/sql-editor.tsx`.
- **react-grid-layout**: `tableros/[id]/drag-drop-grid.tsx`.
- **cmdk**: command palette.

## Recomendaciones priorizadas

1. **CRÍTICO**: agregar `app/dashboard/error.tsx` y `loading.tsx`.
2. **CRÍTICO**: arreglar nav mobile en `dashboard/layout.tsx:39` — menú hamburguesa.
3. **ALTO**: fix `command-palette.tsx:166` deps array.
4. **MEDIO**: migrar fetches de cliente a `@tanstack/react-query` (ya instalado).
5. **MEDIO**: Playwright + smoke tests del happy path (login → dashboard → analisis ejecuta pivot).
6. **BAJO**: agregar `aria-label` a botones icon-only y `not-found.tsx` global.
