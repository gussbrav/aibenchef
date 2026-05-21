# Setup Aibenchef en EasyPanel — guia MVP minimo

EasyPanel v2.28.0 ya esta corriendo en `https://panel.azoramind.com`.

---

## TL;DR — solo 3 acciones

1. **[YA HECHO por Gus]** Database `aibenchef` creada en el `postgres` existente.
2. **Aplicar 5 archivos SQL** en pgAdmin (5 minutos).
3. **Crear 1 servicio `aibenchef-web`** en EasyPanel (10 minutos).

Total: 15 minutos y `https://aibenchef.azoramind.com` esta online con candado verde.

---

## Convencion de nombres en EasyPanel

| Concepto | Ejemplo | Donde se usa |
|---|---|---|
| **Nombre del servicio** (corto) | `aibenchef-web` | En la UI de EasyPanel, sidebar |
| **Hostname interno** (DNS docker) | `aibenchef_aibenchef-web` | En env vars donde un servicio se conecta a otro |

Patron: `<proyecto>_<servicio>`. El postgres existente se llama `azoramind_postgres`.

---

## Paso 1: migraciones — corren SOLAS al deployar

**No tenes que correr nada manual en pgAdmin.** El container `aibenchef-web` arranca con
un migrator que aplica todas las `V*.sql` en orden y mantiene una tabla
`public.schema_migrations` con las versiones ya aplicadas.

Comportamiento al startup del container:
```
[start] running migrations...
[migrator] postgres ready (attempt 1)
[migrator] found 5 migrations; 0 already applied
[migrator] applying V000 (/app/migrations/V000__extensions.sql)
[migrator] OK V000
[migrator] applying V001 (/app/migrations/V001__schemas.sql)
[migrator] OK V001
[migrator] applying V002 (/app/migrations/V002__auth_tenant_billing.sql)
[migrator] OK V002
[migrator] applying V003 (/app/migrations/V003__dw_dimensions.sql)
[migrator] OK V003
[migrator] applying V004 (/app/migrations/V004__dw_fact_observacion.sql)
[migrator] OK V004
[migrator] done
[start] launching Next.js server on port 3000...
```

En el segundo deploy y siguientes, dice `skip V000 (already applied)` etc.

**Mismo patron que usas en el CRM Palma Rio** (ver `.claude/rules/definition-of-done.md`).

Verificar despues del primer deploy (en pgAdmin, query tool sobre `aibenchef`):
```sql
SELECT version, applied_at FROM public.schema_migrations ORDER BY version;
SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = 'auth';
```

Deberias ver V000..V004 en `schema_migrations` y `users`, `sessions`, `accounts`,
`verifications` en `auth`.

---

## Paso 2: agregar CNAME en Cloudflare

Ya tenes `aibenchef.azoramind.com` -> `azoramind.com` (Solo DNS).

**No hace falta agregar nada mas** — la app es todo-en-uno, no hay subdominio para api.

---

## Paso 3: crear `aibenchef-web` en EasyPanel

EasyPanel -> Proyectos -> **Nuevo** -> nombre `aibenchef`.

Dentro del proyecto `aibenchef` -> **"+"** -> **App**.

- **Nombre del servicio:** `aibenchef-web`
- **Origen:** GitHub
- **Repo:** `gussbrav/aibenchef`
- **Branch:** `main`
- **Compilacion:**
  - Tipo: **Dockerfile** (no Buildpacks/Nixpacks)
  - Archivo: `Dockerfile` (en la raiz del repo)
  - Ruta de compilacion: `/`
- **Variables de entorno:**
  ```
  NODE_ENV=production
  DATABASE_URL=postgresql://<user>:<pwd>@azoramind_postgres:5432/aibenchef
  BETTER_AUTH_SECRET=<openssl rand -hex 64>
  BETTER_AUTH_URL=https://aibenchef.azoramind.com
  NEXT_PUBLIC_APP_URL=https://aibenchef.azoramind.com
  ```
  (Las variables Google OAuth y Stripe las agregamos despues cuando integremos esos providers.)

- **Puerto interno:** `3000`
- **Dominios:**
  1. (auto) `https://aibenchef-aibenchef-web.l7weu8.easypanel.host` — usar para probar antes del DNS.
  2. (custom) `https://aibenchef.azoramind.com` -> `http://aibenchef_aibenchef-web:3000`

Click **Implementar** (boton verde — el mismo que vi en tu `crm-azoramind`).

---

## Resumen visual

| Item | Donde | Detalle |
|---|---|---|
| Database `aibenchef` | postgres existente (azoramind) | Ya creada por Gus |
| Migraciones SQL | pgAdmin | bootstrap-extensions + V001 + V002 |
| App `aibenchef-web` | nuevo proyecto `aibenchef` en EasyPanel | Next.js todo-en-uno |
| CNAME publico | Cloudflare | Ya creado |

---

## Verificacion final

1. EasyPanel muestra `aibenchef-web` en verde.
2. https://aibenchef.azoramind.com -> landing carga con candado verde.
3. https://aibenchef.azoramind.com/api/health -> `{"status":"ok",...}`.
4. https://aibenchef.azoramind.com/api/me -> `{"error":"no autenticado"}` con 401 (correcto — aun no hay signup UI).

---

## Cuando agregar mas servicios (no ahora)

| Trigger | Que agregar |
|---|---|
| Empezamos a generar exports PDF/Excel (Fase 4) | `aibenchef-minio` (MinIO template) |
| Hay 3+ dashboards con queries pesadas | `aibenchef-cube` (Cube.dev imagen) |
| El scraper SBS tiene que correr automatico mensual | `aibenchef-worker` (App Python custom desde Git) |
| El postgres compartido empieza a saturarse | `aibenchef-postgres` dedicado y migrar data |
| Necesitamos rate limit serio o queue de jobs | `aibenchef-redis` |

Cada uno se agrega cuando duele no tenerlo, no antes.

---

## Workflow de actualizacion (cada deploy)

```bash
git add .
git commit -m "feat: lo que sea"
git push origin main
```

EasyPanel detecta el push y rebuilds. Si esta auto-deploy on, sale solo; sino click
**Implementar** en EasyPanel.

---

## Glitchtip (opcional, cuando arranque trafico)

Tu glitchtip ya esta en el proyecto `azoramind`. Crear proyecto nuevo:
1. Abrir glitchtip.
2. New Project -> Platform: Next.js. Copiar DSN.
3. Agregar a variables de `aibenchef-web` como `NEXT_PUBLIC_SENTRY_DSN` y `SENTRY_DSN`.
4. Restart.
