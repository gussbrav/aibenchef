# Setup Aibenchef en EasyPanel — guia paso a paso

Este es el **path recomendado de deploy** dado que ya tenes EasyPanel v2.28.0
corriendo en `https://panel.azoramind.com`.

Reemplaza el deploy manual con `docker-compose.production.yml` + `Caddyfile`
(que quedan como fallback documentado en `infrastructure/hetzner/`).

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

---

## Paso 1: crear proyecto `aibenchef` en EasyPanel

1. Panel.azoramind.com -> Proyectos -> **Nuevo**.
2. Nombre: `aibenchef`.
3. Crear.

Esto aisla los servicios de los demas proyectos (`azoramind`, `crm-azoramind`).

---

## Paso 2: agregar servicios base (templates)

Dentro del proyecto `aibenchef`, click **"+"** -> **Plantilla**.

### 2.1 Postgres
- Tipo: PostgreSQL
- Version: **16**
- Nombre: `aibenchef-postgres`
- Password: dejar autogenerar y copiar (la usaremos en API)
- Volumen: persistente
- Recursos: por defecto, ajustar despues si hace falta

### 2.2 Redis
- Tipo: Redis
- Nombre: `aibenchef-redis`
- Por defecto basta

### 2.3 MinIO
- Tipo: MinIO (o si no esta como template, usar imagen `minio/minio:latest`)
- Nombre: `aibenchef-minio`
- Variables:
  - `MINIO_ROOT_USER`: `aibenchef-admin`
  - `MINIO_ROOT_PASSWORD`: generar fuerte (`openssl rand -hex 32`)
- Comando: `server /data --console-address ":9001"`
- Volumen: persistente en `/data`
- Puertos: `9000` (API S3) y `9001` (console web)

---

## Paso 3: aplicar migraciones SQL

EasyPanel -> proyecto `aibenchef` -> `aibenchef-postgres` -> Consola (o usar `pgadmin` ya
existente).

```sql
-- Crear DB (si EasyPanel no la creo)
CREATE DATABASE aibenchef;
\c aibenchef
```

Luego aplicar las 4 migraciones en orden desde
`infrastructure/postgres/migrations/V001..V004` (copy/paste del SQL).

Alternativa por SSH al VPS:

```bash
docker exec -i aibenchef_aibenchef-postgres_1 psql -U postgres -d aibenchef < V001__schemas.sql
docker exec -i aibenchef_aibenchef-postgres_1 psql -U postgres -d aibenchef < V002__auth_tenant_billing.sql
docker exec -i aibenchef_aibenchef-postgres_1 psql -U postgres -d aibenchef < V003__dw_dimensions.sql
docker exec -i aibenchef_aibenchef-postgres_1 psql -U postgres -d aibenchef < V004__dw_fact_observacion.sql
```

(El nombre exacto del container lo ves con `docker ps`).

---

## Paso 4: crear `aibenchef-cube` (App custom)

EasyPanel -> proyecto `aibenchef` -> **"+"** -> **App**.

- Nombre: `aibenchef-cube`
- Origen: **Imagen Docker**
- Imagen: `cubejs/cube:latest`
- Variables:
  ```
  CUBEJS_DEV_MODE=false
  CUBEJS_DB_TYPE=postgres
  CUBEJS_DB_HOST=aibenchef-postgres
  CUBEJS_DB_PORT=5432
  CUBEJS_DB_NAME=aibenchef
  CUBEJS_DB_USER=postgres
  CUBEJS_DB_PASS=<password de aibenchef-postgres>
  CUBEJS_API_SECRET=<openssl rand -hex 32>
  CUBEJS_REDIS_URL=redis://aibenchef-redis:6379
  CUBEJS_WEB_SOCKETS=true
  CUBEJS_LOG_LEVEL=warn
  ```
- Volumenes:
  - Mount: `/cube/conf` <- desde Git (mas adelante) o copiar manual `data-platform/cube/`
- Puerto interno: `4000`
- **No** exponer publicamente — solo lo consume `aibenchef-api`.

---

## Paso 5: crear `aibenchef-api` (App custom desde GitHub)

EasyPanel -> proyecto `aibenchef` -> **"+"** -> **App**.

- Nombre: `aibenchef-api`
- Origen: **GitHub**
- Repo: `gussbrav/aibenchef`
- Branch: `main`
- Build:
  - Tipo: **Dockerfile**
  - Path Dockerfile: `apps/api/Dockerfile`
  - Build context: `apps/api`
- Variables:
  ```
  APP_ENV=production
  DATABASE_URL=postgresql+asyncpg://postgres:<pwd>@aibenchef-postgres:5432/aibenchef
  REDIS_URL=redis://aibenchef-redis:6379
  CUBEJS_API_URL=http://aibenchef-cube:4000/cubejs-api/v1
  CUBEJS_API_SECRET=<mismo que en cube>
  APP_URL=https://aibenchef.azoramind.com
  API_URL=https://api.aibenchef.azoramind.com
  SECRET_KEY=<openssl rand -hex 64>
  MINIO_ENDPOINT=aibenchef-minio:9000
  MINIO_ACCESS_KEY=aibenchef-admin
  MINIO_SECRET_KEY=<pwd de minio>
  MINIO_BUCKET=aibenchef
  MINIO_PUBLIC_URL=https://storage.aibenchef.azoramind.com
  SENTRY_DSN=<de glitchtip — ver paso 8>
  ```
- Puerto interno: `8000`
- Dominio: **api.aibenchef.azoramind.com**, HTTPS automatico (EasyPanel pide cert Let's Encrypt solo).

---

## Paso 6: crear `aibenchef-web` (App custom desde GitHub)

EasyPanel -> proyecto `aibenchef` -> **"+"** -> **App**.

- Nombre: `aibenchef-web`
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
- Dominio: **aibenchef.azoramind.com**, HTTPS automatico.

---

## Paso 7: configurar dominios y TLS

EasyPanel hace esto automatico cuando agregas el dominio al servicio:
- Genera config Traefik
- Solicita cert Let's Encrypt
- Renueva auto cada 60 dias

Si falla TLS al primer intento, verificar:
- CNAME en Cloudflare apunta a `azoramind.com` Y esta en "Solo DNS" (nube gris)
- Puerto 80 abierto en firewall (necesario para HTTP-01 challenge)

---

## Paso 8: integrar Glitchtip (Sentry self-hosted)

Glitchtip ya esta en tu proyecto `azoramind`. Crear nuevo proyecto dentro:

1. Abrir glitchtip en tu navegador (domain configurado en EasyPanel para ese servicio).
2. Login.
3. New Project -> Platform: Python (Aibenchef API). Copiar DSN.
4. New Project -> Platform: JavaScript (Next.js). Copiar DSN.
5. Pegar DSNs en variables de `aibenchef-api` y `aibenchef-web` (paso 5 y 6).
6. Restart ambos servicios.

---

## Paso 9: scraping mensual via n8n

n8n ya esta en tu stack. En lugar de Prefect/Airflow:

1. Abrir n8n en navegador.
2. New Workflow: "SBS Monthly Ingestion".
3. Trigger: **Cron**, cron expression `0 6 5 * *` (dia 5 de cada mes 06:00).
4. Node 1: **Execute Command** -> ejecuta el scraper Python en container `aibenchef-worker`:
   ```
   docker exec aibenchef-worker python -m scrapers.sbs.cli ingest
   ```
5. Node 2: **HTTP Request** -> POST a webhook de notificacion (Slack o WhatsApp via evolution).
6. Activar workflow.

(El servicio `aibenchef-worker` lo creamos en Fase 1.)

---

## Paso 10: metricas en Grafana

Tu grafana existente puede scrapear el endpoint `/metrics` de FastAPI (cuando lo agreguemos
con `prometheus-fastapi-instrumentator` en Fase 3).

1. Prometheus existente: agregar scrape config para `aibenchef-api:8000/metrics`.
2. Grafana: importar dashboard FastAPI (ID `14282`) y conectarlo a tu Prometheus.

---

## Paso 11: backups del Postgres de Aibenchef

EasyPanel -> `aibenchef-postgres` -> Backups -> programar diario a las 03:00.
Destino: bucket Backblaze B2 (USD 0.005/GB/mes) o el mismo MinIO si quieres todo interno.

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
on push, sino click "Deploy" en EasyPanel).

---

## Cuando reconsiderar la decision EasyPanel

Migrar a Coolify, Kubernetes o managed (Vercel/Railway) si:
- EasyPanel se queda corto en features (multi-region, autoscaling, blue/green).
- El VPS Hetzner se queda chico y queremos managed Postgres.
- Algun cliente Enterprise pide infraestructura certificada (SOC2, HIPAA).

Hasta entonces: EasyPanel + 1 VPS = solucion mas costo-eficiente del mercado.
