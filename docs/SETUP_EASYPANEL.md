# Setup Aibenchef en EasyPanel — guia paso a paso

Este es el **path recomendado de deploy** dado que ya tenes EasyPanel v2.28.0
corriendo en `https://panel.azoramind.com`.

Reemplaza el deploy manual con `docker-compose.production.yml` + `Caddyfile`
(que quedan como fallback documentado en `infrastructure/hetzner/`).

---

## TL;DR — stack minimo para arrancar (MVP)

Solo necesitas **2 servicios nuevos en EasyPanel** + **1 database nueva en el postgres existente**:

1. Database `aibenchef` en el servicio `postgres` que ya tenes (proyecto azoramind).
2. App `aibenchef-api` (FastAPI desde GitHub).
3. App `aibenchef-web` (Next.js desde GitHub).

En 30 min tenes `aibenchef.azoramind.com` con candado verde online.

Los demas servicios (redis, minio, cube, worker, postgres dedicado) los agregamos
**solo cuando los necesitamos**. Ver seccion "Cuando agregar mas servicios" al final.

---

## Convencion de nombres en EasyPanel (importante)

EasyPanel separa dos cosas:

| Concepto | Ejemplo | Donde se usa |
|---|---|---|
| **Nombre del servicio** (corto) | `aibenchef-postgres` | En la UI de EasyPanel, en el nombre que ves en el sidebar |
| **Hostname interno** (resolucion DNS dentro de la red docker) | `aibenchef_aibenchef-postgres` | En las variables de entorno donde un servicio se conecta a otro |

El hostname interno es `<proyecto>_<servicio>`. Ejemplo del CRM Palma Rio que ya tenes:
`azoramind_crm-azoramind:8002`.

Asi que en este doc:
- Al crear el servicio uso el **nombre corto** (`aibenchef-postgres`).
- En `DATABASE_URL` y similares uso el **hostname interno** (`aibenchef_aibenchef-postgres`).

---

## Antes de empezar

### 1. Cloudflare DNS

Ya tenes `aibenchef` creado. Agregar estos 3 mas (todos en **Solo DNS**, nube gris):

```
CNAME  api.aibenchef               -> azoramind.com   Solo DNS
CNAME  storage.aibenchef           -> azoramind.com   Solo DNS
CNAME  storage-console.aibenchef   -> azoramind.com   Solo DNS
```

### 2. Verificar memoria libre en EasyPanel

Panel.azoramind.com -> Panel. Confirmar al menos 4 GB libres. Aibenchef necesita:
- Postgres dedicado: 1-2 GB
- Cube.dev: 512 MB - 1 GB
- API FastAPI: 256 MB
- Web Next.js: 256 MB
- Redis: 256 MB
- MinIO: 256 MB
- **Total**: ~3-4 GB en uso normal

Tu VPS tiene 17 GB libres -> holgura tranquila.

---

## Paso 1: crear proyecto `aibenchef` en EasyPanel

1. Panel.azoramind.com -> Proyectos -> **Nuevo**.
2. Nombre: `aibenchef`.
3. Crear.

Esto aisla los servicios de los demas proyectos (`azoramind`, `crm-azoramind`).

---

## Paso 2: crear database `aibenchef` en el postgres existente

NO crear un nuevo servicio postgres. Reusamos el `postgres` del proyecto `azoramind`.

EasyPanel -> proyecto `azoramind` -> servicio `postgres` -> Consola (o conectarte con
`pgadmin` que ya tenes):

```sql
CREATE DATABASE aibenchef;
CREATE USER aibenchef_app WITH PASSWORD '<generar con openssl rand -hex 32>';
GRANT ALL PRIVILEGES ON DATABASE aibenchef TO aibenchef_app;
\c aibenchef
GRANT ALL ON SCHEMA public TO aibenchef_app;
```

Anotar el password — lo vas a usar en `DATABASE_URL` de la API.

Hostname interno desde otros servicios: `azoramind_postgres:5432` (asi se llama el postgres
existente; verificar con `docker ps | grep postgres`).

---

## Paso 3: aplicar migraciones SQL

Conectado a la database `aibenchef` (paso 2), aplicar las 4 migraciones en orden desde
`infrastructure/postgres/migrations/V001..V004`:

- V001: schemas (auth, tenant, billing, raw, dw, marts, api, audit)
- V002: tablas auth + tenant + billing + RLS policies
- V003: dimensiones del DW (dim_tiempo, dim_entidad, dim_cuenta, etc.)
- V004: fact_observacion particionado por anio

Forma facil: abrir `pgadmin`, conectarte a `aibenchef`, abrir cada archivo en Query Tool y
ejecutar (F5).

Forma SSH:
```bash
# El nombre del container postgres lo ves con: docker ps | grep azoramind_postgres
docker exec -i <container> psql -U postgres -d aibenchef < V001__schemas.sql
docker exec -i <container> psql -U postgres -d aibenchef < V002__auth_tenant_billing.sql
docker exec -i <container> psql -U postgres -d aibenchef < V003__dw_dimensions.sql
docker exec -i <container> psql -U postgres -d aibenchef < V004__dw_fact_observacion.sql
```

---

## Paso 4: crear `aibenchef-api` (App desde GitHub)

EasyPanel -> proyecto `aibenchef` -> **"+"** -> **App**.

- Nombre del servicio: `aibenchef-api`
- Origen: **GitHub**
- Repo: `gussbrav/aibenchef`
- Branch: `main`
- Build:
  - Tipo: **Dockerfile**
  - Path Dockerfile: `apps/api/Dockerfile`
  - Build context: `apps/api`
- Variables minimas:
  ```
  APP_ENV=production
  DATABASE_URL=postgresql+asyncpg://aibenchef_app:<pwd>@azoramind_postgres:5432/aibenchef
  APP_URL=https://aibenchef.azoramind.com
  API_URL=https://api.aibenchef.azoramind.com
  SECRET_KEY=<openssl rand -hex 64>
  SENTRY_DSN=<de glitchtip — ver paso 7, opcional al inicio>
  ```
- Puerto interno: `8000`
- Dominios:
  1. (auto) `https://aibenchef-aibenchef-api.l7weu8.easypanel.host` -> usar para probar antes del DNS
  2. (custom) `https://api.aibenchef.azoramind.com` -> `http://aibenchef_aibenchef-api:8000`

---

## Paso 5: crear `aibenchef-web` (App desde GitHub)

EasyPanel -> proyecto `aibenchef` -> **"+"** -> **App**.

- Nombre del servicio: `aibenchef-web`
- Origen: **GitHub**
- Repo: `gussbrav/aibenchef`
- Branch: `main`
- Build:
  - Tipo: **Dockerfile**
  - Path Dockerfile: `apps/web/Dockerfile`
  - Build context: **raiz del repo** (necesita el monorepo entero para pnpm workspaces)
- Variables:
  ```
  NODE_ENV=production
  NEXT_PUBLIC_API_URL=https://api.aibenchef.azoramind.com
  NEXT_PUBLIC_APP_URL=https://aibenchef.azoramind.com
  NEXT_PUBLIC_SENTRY_DSN=<de glitchtip>
  ```
- Puerto interno: `3000`
- Dominios:
  1. (auto) `https://aibenchef-aibenchef-web.l7weu8.easypanel.host` -> para probar antes del DNS
  2. (custom) `https://aibenchef.azoramind.com` -> `http://aibenchef_aibenchef-web:3000`

---

## Resumen visual MVP — solo lo que creas ahora

| Servicio | Donde | Puerto | Dominio publico | Hostname interno |
|---|---|---|---|---|
| Database `aibenchef` | en `postgres` existente (proyecto azoramind) | 5432 | — | `azoramind_postgres:5432` |
| `aibenchef-api` | nuevo en proyecto `aibenchef` | 8000 | `api.aibenchef.azoramind.com` | `aibenchef_aibenchef-api:8000` |
| `aibenchef-web` | nuevo en proyecto `aibenchef` | 3000 | `aibenchef.azoramind.com` | `aibenchef_aibenchef-web:3000` |

CNAMEs minimos en Cloudflare:
```
CNAME  aibenchef       -> azoramind.com   Solo DNS  (ya creado)
CNAME  api.aibenchef   -> azoramind.com   Solo DNS  (agregar)
```

Los CNAMEs `storage.aibenchef` y `storage-console.aibenchef` los agregamos cuando metamos
MinIO (Fase 4).

---

## Paso 6: configurar TLS

EasyPanel + Traefik lo hacen automatico cuando agregas el dominio custom:
- Solicita cert Let's Encrypt
- Renueva auto cada 60 dias

Si falla TLS al primer intento, verificar:
- CNAME en Cloudflare apunta a `azoramind.com` Y esta en "Solo DNS" (nube gris).
- Puerto 80 abierto en el firewall (HTTP-01 challenge).

---

## Paso 7: integrar Glitchtip (Sentry self-hosted) — opcional

Glitchtip ya esta en tu proyecto `azoramind`. Crear proyectos nuevos para Aibenchef:

1. Abrir glitchtip en tu navegador (dominio configurado en EasyPanel para ese servicio).
2. Login.
3. New Project -> Platform: Python (Aibenchef API). Copiar DSN.
4. New Project -> Platform: JavaScript (Next.js). Copiar DSN.
5. Pegar DSNs en variables de `aibenchef-api` (SENTRY_DSN) y `aibenchef-web` (NEXT_PUBLIC_SENTRY_DSN).
6. Restart ambos servicios.

---

## Paso 8: scraping mensual via n8n — cuando tengamos scraper funcional

n8n ya esta en tu stack. En lugar de Prefect/Airflow:

1. Abrir n8n en navegador.
2. New Workflow: "SBS Monthly Ingestion".
3. Trigger: **Cron**, expresion `0 6 5 * *` (dia 5 de cada mes 06:00).
4. Node 1: **Execute Command** -> ejecuta el scraper en el container worker:
   ```
   docker exec <aibenchef-worker container> python -m scrapers.sbs.cli ingest
   ```
5. Node 2: **HTTP Request** -> POST a webhook de notificacion (Slack o WhatsApp via `evolution`).
6. Activar workflow.

(El servicio `aibenchef-worker` lo creamos en Fase 1.)

---

## Paso 9: metricas en Grafana — cuando haya trafico real

Tu Grafana existente puede scrapear `/metrics` de FastAPI (cuando lo agreguemos con
`prometheus-fastapi-instrumentator` en Fase 3).

1. Prometheus existente: agregar scrape config para `aibenchef_aibenchef-api:8000/metrics`.
2. Grafana: importar dashboard FastAPI (ID `14282`) y conectarlo a Prometheus.

---

## Paso 10: backups del Postgres

Como reusamos el postgres existente, los backups que ya tengas configurados ahi tambien
cubren la database `aibenchef`. Verificar.

Si no hay backups configurados: EasyPanel -> proyecto azoramind -> `postgres` -> Backups
-> programar diario a las 03:00.

---

## Cuando agregar mas servicios (no ahora)

| Trigger | Que agregar |
|---|---|
| Necesitas rate limit serio o queue de jobs | `aibenchef-redis` (Redis template, 1 click) |
| Empezamos a generar exports PDF/Excel (Fase 4) | `aibenchef-minio` (MinIO template) |
| Hay 3+ dashboards con queries pesadas | `aibenchef-cube` (Cube.dev imagen) |
| El scraper SBS tiene que correr automatico mensual | `aibenchef-worker` (App custom desde Git) |
| El postgres compartido empieza a saturarse | `aibenchef-postgres` dedicado (Postgres template) y migrar data |

Cada uno se agrega cuando duele no tenerlo, no antes.

---

## Verificacion final

1. https://aibenchef.azoramind.com -> landing carga, candado verde.
2. https://api.aibenchef.azoramind.com/v1/health -> `{"status":"ok"}`.
3. https://api.aibenchef.azoramind.com/docs -> Swagger (solo si APP_ENV != production).
4. Glitchtip recibe el primer evento `api.startup`.
5. EasyPanel muestra los 6 servicios en verde.

---

## Workflow de actualizacion (cada deploy)

Solo necesitas:

```bash
# Local
git add .
git commit -m "feat: lo que sea"
git push origin main
```

EasyPanel detecta el push, rebuilds y rolling update automatico (si configuraste auto-deploy
on push, sino click "Implementar" en EasyPanel — como el boton verde que vi en tu CRM).

---

## Cuando reconsiderar la decision EasyPanel

Migrar a Coolify, Kubernetes o managed (Vercel/Railway) si:
- EasyPanel se queda corto en features (multi-region, autoscaling, blue/green).
- El VPS Hetzner se queda chico y queremos managed Postgres.
- Algun cliente Enterprise pide infraestructura certificada (SOC2, HIPAA).

Hasta entonces: EasyPanel + 1 VPS = solucion mas costo-eficiente del mercado.
