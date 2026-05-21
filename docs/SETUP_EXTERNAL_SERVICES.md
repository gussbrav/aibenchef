# Setup de servicios — Hetzner self-hosted

Este documento reemplaza el anterior `SETUP_EXTERNAL_SERVICES.md` cuando se decidio
self-hostear todo en Hetzner. Casi nada requiere cuenta externa.

---

## Estado al 2026-05-21

- [x] **Cloudflare DNS**: CNAME `aibenchef.azoramind.com` -> `azoramind.com` (Solo DNS, sin proxy).
- [x] **GitHub repo**: https://github.com/gussbrav/aibenchef (Gus lo creo).
- [x] **Hetzner VPS**: 24 GB RAM ya operativo, CRM Palma Rio corriendo ahi.
- [ ] **DNS adicionales** (cuando deployemos): `api.aibenchef`, `storage.aibenchef`, `storage-console.aibenchef`.
- [ ] **Resend** (email transaccional, free tier): pendiente Fase 4.
- [ ] **Stripe** (billing): pendiente Fase 5.
- [ ] **Sentry** dev plan (opcional): pendiente Fase 4.

---

## 1. Cloudflare — DNS records (sin proxy por ahora)

CNAME ya creado:
```
CNAME  aibenchef        -> azoramind.com  (Solo DNS)
```

**Antes del primer deploy**, agregar estos otros:

```
CNAME  api.aibenchef               -> azoramind.com  (Solo DNS)
CNAME  storage.aibenchef           -> azoramind.com  (Solo DNS)
CNAME  storage-console.aibenchef   -> azoramind.com  (Solo DNS)
```

**Importante:** dejar todos en "Solo DNS" (nube gris) hasta que Caddy emita el certificado
TLS Let's Encrypt. Caddy necesita resolver el challenge HTTP-01 directo al VPS.

**Despues del primer deploy exitoso**, podes opcionalmente prender el proxy naranja en
Cloudflare para ganar:
- Cache estatica gratis (mejora velocidad LATAM)
- DDoS proteccion
- Reglas de WAF

Pero antes de prender el proxy, cambiar el dominio en `Caddyfile` a usar TLS DNS-01
challenge (requiere API token de Cloudflare).

---

## 2. Bootstrap del VPS Hetzner (primera vez)

SSH al VPS como root:

```bash
ssh root@46.224.250.197
```

Bajar y correr el bootstrap:

```bash
curl -fsSL https://raw.githubusercontent.com/gussbrav/aibenchef/main/infrastructure/hetzner/bootstrap.sh | bash
```

Esto:
- Actualiza paquetes
- Instala Docker + Docker Compose plugin
- Crea usuario `aibenchef` sin privilegios root
- Activa UFW firewall (22/80/443)
- Activa fail2ban
- Clona el repo en `/home/aibenchef/aibenchef`

---

## 3. Configurar secrets de produccion

```bash
su - aibenchef
cd ~/aibenchef/infrastructure/hetzner
cp .env.production.example .env.production
```

Generar secrets fuertes (correr en el VPS):

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)" >> .env.production
echo "API_SECRET_KEY=$(openssl rand -hex 64)" >> .env.production
echo "CUBEJS_API_SECRET=$(openssl rand -hex 32)" >> .env.production
echo "MINIO_ROOT_PASSWORD=$(openssl rand -hex 32)" >> .env.production
```

Editar `.env.production` y limpiar lineas duplicadas:

```bash
nano .env.production
```

---

## 4. Verificar que no haya conflicto con CRM Palma Rio

```bash
# Que esta usando puertos 80/443?
sudo ss -tlnp | grep -E ':80 |:443 '
```

Si CRM Palma Rio tiene un Nginx/Caddy en 80/443:
- **Opcion A** (mejor): migrar CRM Palma Rio detras del nuevo Caddy de Aibenchef. Editar `Caddyfile` para agregar el dominio del CRM como otro `reverse_proxy`.
- **Opcion B** (rapida): correr el Caddy de Aibenchef en otros puertos (8080/8443) y dejar que el Nginx/Caddy existente le haga proxy con `proxy_pass http://localhost:8080`.

Si no hay nada en 80/443, podemos arrancar Aibenchef en esos puertos directamente.

---

## 5. Primer deploy

```bash
cd ~/aibenchef/infrastructure/hetzner
bash ../../infrastructure/hetzner/deploy.sh
```

Esto:
- `git pull` del repo
- Build de imagenes Docker
- Aplica migraciones SQL
- Levanta stack completo (Caddy, Postgres, Redis, MinIO, Cube, API, Web)
- Caddy negocia certificado TLS Let's Encrypt automatico

**Verificar:**
```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs caddy -f
```

Abrir en navegador:
- https://aibenchef.azoramind.com — debe mostrar landing con candadito verde
- https://api.aibenchef.azoramind.com/v1/health — debe devolver `{"status":"ok"}`

---

## 6. Servicios externos (los unicos que requieren cuenta externa)

### Resend (email transaccional) — gratis 3k emails/mes

**Cuando:** Fase 4, cuando agreguemos signup/recovery con email.

1. https://resend.com -> Sign up con `gussbrav@gmail.com`.
2. Domains -> Add `aibenchef.azoramind.com` -> Resend te da 3 records DNS (SPF, DKIM, MX). Agregar en Cloudflare.
3. API Keys -> Create key -> copiar a `.env.production` como `RESEND_API_KEY`.
4. Restart api: `docker compose restart api`.

### Sentry (opcional) — gratis 5k errores/mes

**Cuando:** Fase 4, cuando arranquemos a tener trafico real.

1. https://sentry.io -> Free dev plan.
2. New Project -> Next.js -> copiar DSN -> `NEXT_PUBLIC_SENTRY_DSN`.
3. New Project -> Python (FastAPI) -> copiar DSN -> `SENTRY_DSN`.

### Stripe (billing) — sin costo fijo, fee por transaccion 3.9% + USD 0.30

**Cuando:** Fase 5, semana 13-14.

1. https://stripe.com -> Create account.
2. Test mode primero. Crear productos (Starter, Pro, Business) con precios definidos tras entrevistas.
3. Webhook endpoint: `https://api.aibenchef.azoramind.com/v1/webhooks/stripe` con eventos `customer.subscription.*`, `invoice.*`.
4. Copiar `Secret key`, `Publishable key`, `Webhook secret` a `.env.production`.

### Nubefact (facturacion Peru) — ~USD 30/mes

**Cuando:** Fase 5, cuando entre el primer cliente pagante peruano.

1. https://nubefact.com -> Cuenta empresa (con RUC).
2. Configurar series F001 (facturas) y B001 (boletas).
3. Token API -> `NUBEFACT_TOKEN` en `.env.production`.

---

## 7. Backups y mantenimiento

### Backup Postgres diario

Cron en el VPS como root:

```bash
crontab -e
```

```cron
0 3 * * * docker exec aibenchef-postgres pg_dump -U aibenchef aibenchef | gzip > /backups/aibenchef-$(date +\%Y\%m\%d).sql.gz
0 4 * * * find /backups -name 'aibenchef-*.sql.gz' -mtime +30 -delete
```

**Mejor:** subir a un bucket Backblaze B2 (USD 0.005/GB/mes) o R2 con `rclone`.

### Update mensual del VPS

```bash
ssh root@46.224.250.197 'apt-get update && apt-get upgrade -y && reboot'
```

### Logs

```bash
# Tail de todos los servicios
cd ~/aibenchef/infrastructure/hetzner
docker compose -f docker-compose.production.yml logs -f --tail=100

# Solo errores
docker compose -f docker-compose.production.yml logs --since=1h | grep -i error
```

---

## Costos al ano 1 — actualizado

| Item | Costo mensual estimado |
|---|---|
| Hetzner VPS (ya tenes) | USD 0 (asumido) |
| Cloudflare DNS | USD 0 |
| Dominio (azoramind.com ya tenes) | USD 0 |
| Resend free tier | USD 0 |
| Sentry free tier | USD 0 |
| MinIO self-hosted | USD 0 |
| Stripe (sin transacciones aun) | USD 0 |
| **TOTAL meses 1-4** | **USD 0** |
| Nubefact (cuando entre primer pago) | USD 30 |
| Stripe fees (3.9% del MRR) | variable |
| **TOTAL meses 5+** | **USD 30 + fees Stripe** |
