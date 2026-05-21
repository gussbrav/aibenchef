# Setup de servicios externos — accion del humano

Este documento lista paso a paso lo que **tiene que hacer Gus manualmente** en cada
servicio externo. Va en orden de prioridad. Marcar con `[x]` lo hecho.

---

## 1. Cloudflare — subdominios DNS

### Pre-requisito
- `azoramind.com` debe estar gestionado en Cloudflare (DNS apuntando a tus nameservers).

### Subdominios a crear (los 3 al mismo tiempo)

Andate a `https://dash.cloudflare.com` -> seleccionar `azoramind.com` -> DNS -> Records.

Por ahora **NO crear los CNAMEs todavia** porque los servicios destino aun no existen.
Solo reservar los nombres mentalmente:

| Subdominio | Para que | DNS final (cuando deploy este listo) |
|---|---|---|
| `aibenchef.azoramind.com` | Frontend Next.js | CNAME -> `cname.vercel-dns.com` |
| `api.aibenchef.azoramind.com` | Backend FastAPI | CNAME -> `<railway-app>.up.railway.app` |
| `storage.aibenchef.azoramind.com` | Cloudflare R2 publico | CNAME -> R2 custom domain (auto) |

**Accion ahora:** ninguna. Vuelvo a este doc cuando levantemos Vercel/Railway.

---

## 2. GitHub — repositorio remoto

```bash
# crear repo privado en github (via web o gh cli)
gh repo create gussbrav/aibenchef --private --source=. --remote=origin --push
# o manual:
# 1. crear gussbrav/aibenchef en github.com
# 2. cd D:\PROYECTO\SBS\aibenchef
# 3. git remote add origin git@github.com:gussbrav/aibenchef.git
# 4. git push -u origin main
```

**Accion ahora:** crear el repo y pushear el commit inicial.

---

## 3. Vercel — frontend

1. Andate a `https://vercel.com` y conectate con tu cuenta GitHub.
2. Import Project -> seleccionar `aibenchef`.
3. Framework Preset: Next.js (auto detectado).
4. Root Directory: `apps/web`.
5. Build Command: `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter web build`.
6. Output: `apps/web/.next` (auto).
7. Variables de entorno: vacias por ahora; iremos rellenando en Fase 1.
8. Deploy.
9. Una vez deployado, ve a Settings -> Domains -> Add `aibenchef.azoramind.com`.
10. Vercel te da un CNAME a apuntar -> volve a Cloudflare y crea el record.

**Accion ahora:** opcional, podes esperar a Fase 1 cuando haya pagina real.

---

## 4. Railway — backend + postgres + cube

1. `https://railway.app` -> Login con GitHub.
2. New Project -> Deploy from GitHub repo -> `aibenchef`.
3. Crear 3 services dentro del proyecto:
   - **api**: Root Directory `apps/api`, command `uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
   - **cube**: Image `cubejs/cube:latest`, mount `data-platform/cube` como volumen.
   - **postgres** (recomendado): plugin Postgres de Railway, o si crece migrar a Neon.
4. Variables de entorno por service (copiar de `.env.example`).
5. Generar dominio publico `api.aibenchef.azoramind.com` en Settings de service `api`.
6. Railway te da CNAME -> agregar en Cloudflare.

**Accion ahora:** crear cuenta Railway (gratis para empezar, ~USD 5 credito mensual). Configurar service en Fase 1.

---

## 5. Clerk vs Supabase Auth — decision pendiente

Lee `docs/adr/002-clerk-vs-supabase.md`.

Recomendacion: **Supabase** (ahorra costos y combina auth + db + storage).

Si Supabase:
1. `https://supabase.com` -> New Project -> region `us-east-1` (mas cerca de Peru via cable transatlantico) o `sa-east-1` (Sao Paulo, ping menor).
2. Crear proyecto `aibenchef-prod`.
3. Settings -> API -> copiar `URL`, `anon key`, `service_role key`.
4. Pegarlas en `.env` (variables a agregar luego).
5. Authentication -> Providers -> habilitar Email + Google + Microsoft.
6. Database -> Settings -> Connection string -> copiar la "Session pooler" string para `DATABASE_URL`.

**Accion ahora:** crear cuenta Supabase y proyecto. No tocar tablas todavia.

Si Clerk:
1. `https://clerk.com` -> New Application.
2. Habilitar Organizations en Settings.
3. Email + Google + Microsoft providers.
4. Copiar `Publishable key` y `Secret key` al `.env`.

---

## 6. Stripe — billing

1. `https://stripe.com` -> Create account (modo Test).
2. Copiar `Publishable key` y `Secret key` (test mode) -> `.env`.
3. Products -> crear 5 productos: Starter / Pro / Business / Enterprise / API Metered.
   - **NO crear aun** — esperar a Fase 5 cuando definamos precios finales con feedback de leads.
4. Webhooks -> crear endpoint apuntando a `https://api.aibenchef.azoramind.com/v1/webhooks/stripe` con eventos:
   - `customer.subscription.*`
   - `invoice.paid`
   - `invoice.payment_failed`

**Accion ahora:** solo crear cuenta. Productos en Fase 5.

---

## 7. Cloudflare R2 — storage

1. Cloudflare Dashboard -> R2 Object Storage -> Create bucket `aibenchef-prod`.
2. R2 -> Manage R2 API Tokens -> Create API Token -> scope `Object Read & Write`.
3. Copiar `Access Key ID` y `Secret Access Key` -> `.env`.
4. (Opcional) Bucket -> Settings -> Custom Domains -> conectar `storage.aibenchef.azoramind.com`.

**Accion ahora:** opcional, puede esperar a Fase 1.

---

## 8. Resend — email transaccional

1. `https://resend.com` -> Sign up.
2. Domains -> Add `aibenchef.azoramind.com` -> seguir instrucciones DNS (SPF, DKIM, DMARC en Cloudflare).
3. API Keys -> Create key -> `.env`.

**Accion ahora:** opcional, Fase 4 cuando haya signup.

---

## 9. Sentry + PostHog — observabilidad

1. Sentry: `https://sentry.io` -> Free dev plan. New Project -> Next.js + Python. Copiar 2 DSNs.
2. PostHog: `https://posthog.com` -> Free hasta 1M events. Copiar `project key` y `host`.

**Accion ahora:** opcional, Fase 4.

---

## 10. Nubefact — facturacion electronica Peru

1. `https://nubefact.com` -> Crear cuenta empresa (necesitas RUC).
2. Setup serie de comprobantes (Factura F001, Boleta B001).
3. Generar token API -> `.env`.

**Accion ahora:** Fase 5 cuando haya primer pago.

---

## Checklist prioridad

### Esta semana (sem 1)
- [ ] Crear repo GitHub y push.
- [ ] Cuenta Supabase + proyecto vacio.
- [ ] Cuenta Stripe (test mode).
- [ ] Cuenta Cloudflare R2 + bucket.
- [ ] Verificar que `azoramind.com` esta en Cloudflare con DNS gestionado ahi.

### Semana 8 (cuando haya MVP demo)
- [ ] Vercel deploy + DNS `aibenchef.azoramind.com`.
- [ ] Railway deploy + DNS `api.aibenchef.azoramind.com`.
- [ ] Sentry + PostHog conectados.

### Semana 13-14 (billing)
- [ ] Stripe productos definidos con precios finales.
- [ ] Stripe webhook en prod.
- [ ] Nubefact integrado.

---

## Costos estimados al ano 1

| Servicio | Costo mensual estimado | Comentario |
|---|---|---|
| Cloudflare (DNS + R2 100GB) | USD 5 | R2 escala bien |
| Vercel Pro (post free tier) | USD 20 | Cuando pasamos 100GB bw |
| Railway | USD 20-50 | Postgres + 2 services + workers |
| Supabase | USD 0-25 | Free hasta 50k MAU; Pro USD 25 |
| Stripe | 3.9% + USD 0.30 por transaccion | Sin fee fijo mensual |
| Resend | USD 0 | Free hasta 3k emails/mes |
| Sentry | USD 0-29 | Free dev plan suficiente al inicio |
| PostHog | USD 0 | Free hasta 1M events |
| Nubefact | ~USD 30 | Plan basico Peru |
| Dominio | USD 1 | Ya tienes azoramind.com |
| **TOTAL inicial** | **~USD 80-130/mes** | Hasta ~50 orgs activas |
