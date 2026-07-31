# Design Doc — Billing Flow V1

**Estado**: DRAFT — pending review
**Autor**: gussbrav (con Claude)
**Fecha**: 2026-05-31
**Issue tracking**: (se crea tras aprobacion del doc)

---

## 1. Problema

Aibenchef todavia no cobra a nadie. Antes de abrir suscripciones publicas
necesitamos resolver, en orden:

1. **Como cobramos** (tarjeta peruana, Yape, transferencia) sin armar
   integracion directa con bancos.
2. **Como emitimos comprobante electronico** (factura/boleta) cumpliendo
   SUNAT — no es opcional, toda venta en Peru exige CPE valido emitido
   via SEE (Sistema de Emision Electronica) en tiempo cuasi-real.
3. **Como manejamos el ciclo de vida** de la suscripcion (renovacion,
   cobro fallido, upgrade/downgrade, cancelacion, reembolso).
4. **Como evitamos atar al MVP a un ERP pesado** (Odoo, Defontana) que
   nos lentee la velocidad de iteracion los primeros 12 meses.

Si esto no se resuelve antes del primer cliente pagado, terminamos
emitiendo CPE a mano por nubefact.com (UI), perdiendo trazabilidad,
sin webhook que avise cobros fallidos, y sin forma de auto-renovar.

## 2. Objetivo de V1

Que un cliente pueda, sin intervencion humana:

1. Elegir un plan (mensual o anual) en el portal de Aibenchef.
2. Pagar con **tarjeta** (Visa/Mastercard/Amex) o **Yape** via Culqi.
3. Recibir por email su **factura** (si dio RUC) o **boleta** (si dio DNI)
   electronica emitida por AzoraTech SAC, con XML+PDF, valida en SUNAT.
4. Que su suscripcion se **renueve sola** al cierre del periodo y se
   emita un nuevo CPE.
5. Que un cobro fallido entre en **dunning** automatico (reintentos +
   emails) y, si todo falla, marque la cuenta `past_due` y limite acceso.

El operador (vos, hoy) debe ver en una sola pantalla admin:
- Subscripciones activas / past_due / canceladas
- CPE emitidos del mes (cuadrar contra reporte mensual del contador)
- Pagos fallidos pendientes de revision

## 3. No-objetivos de V1

Quedan fuera (V2 o despues):

- **Multi-moneda / cobro internacional** (USD via Stripe, MoR como Paddle).
  V1 es solo PEN, mercado peruano.
- **Pagos por transferencia / deposito bancario manual** (reconciliacion
  via webhook BCP/Interbank). V2 si hay demanda B2B grande.
- **Plan prepago / topup** (creditos consumibles por uso). Solo mensual y
  anual con monto fijo en V1.
- **Prorrateo fino de upgrades a mitad de periodo**. V1 es upgrade simple
  con credit-note al final del periodo viejo.
- **Notas de credito automaticas** por reembolso parcial. V1 solo soporta
  cancelacion al cierre del periodo (sin reembolso) y reembolso total
  (emite nota de credito manual desde admin).
- **Reportes contables tipo ERP** (libro de ventas PLE formato SUNAT).
  El contador externo arma PLE desde los XML que exportamos.
- **Integracion con ERP** (Odoo, Bsale, Defontana). Ver apendice
  "Evolucion del stack" para triggers de migracion.
- **Cobranza a empresa con cuentas por cobrar a 30/60/90 dias**. V1 es
  solo cobro inmediato con tarjeta.

## 4. Arquitectura propuesta

### 4.1 Stack elegido

| Capa | Proveedor | Por que |
|---|---|---|
| **Pasarela de pago** | [Culqi](https://culqi.com) | API REST limpia, soporta Pagos Recurrentes con `card_id`, integra Yape nativo, 3.99% + IGV por transaccion. Alternativa Izipay tiene menos docs y API mas vieja |
| **Emisor CPE (PSE)** | [Nubefact](https://www.nubefact.com) | API REST simple, `POST /api/v1/invoice` devuelve XML+PDF firmados y enviados a SUNAT en 1 call. Plan inicial 200 CPE/mes ~S/.45 |
| **Razon social emisora** | AzoraTech SAC (RUC 20614399555) | SAC ACTIVA + HABIDO en SUNAT, actividad 6201 (Programacion Informatica), domicilio Arequipa. **No es emisora electronica todavia — requiere afiliacion al SEE via PSE antes de emitir** (ver seccion 7 Riesgos) |
| **Persistencia** | PostgreSQL schema `billing` | Mismo PG que `raw`/`marts`. Schema separado para aislar dominio |
| **Cron de renovaciones** | GitHub Actions schedule | Mismo runner que tenemos para scrapes SBS. Idempotente con `INSERT ON CONFLICT` |
| **Notificaciones email** | Resend (o SendGrid) | API simple, plantillas HTML, dominio `billing@azoramind.com` |

**Tradeoff principal:** Culqi solo cobra PEN y tarjetas peruanas /
internacionales con BIN aceptado. Si en V2 vendemos en USD a fuera,
sumamos Stripe en paralelo (no reemplaza Culqi).

### 4.2 Modelo de datos

```sql
-- Migracion V<N>_billing_initial.sql

CREATE SCHEMA IF NOT EXISTS billing;

-- 1. Planes (catalogo, seed inicial)
CREATE TABLE IF NOT EXISTS billing.plans (
    id TEXT PRIMARY KEY,              -- 'starter_monthly', 'pro_annual'
    nombre TEXT NOT NULL,
    descripcion TEXT,
    intervalo TEXT NOT NULL CHECK (intervalo IN ('month', 'year')),
    monto_pen NUMERIC(10,2) NOT NULL, -- monto SIN IGV
    igv_pct NUMERIC(5,2) NOT NULL DEFAULT 18.00,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Cliente facturable (1 por tenant)
CREATE TABLE IF NOT EXISTS billing.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES admin.tenants(id) ON DELETE RESTRICT,

    -- datos para CPE
    tipo_documento TEXT NOT NULL CHECK (tipo_documento IN ('RUC', 'DNI', 'CE', 'PAS')),
    numero_documento TEXT NOT NULL,
    razon_social TEXT NOT NULL,       -- razon social (RUC) o nombre completo (DNI)
    direccion TEXT,                   -- requerida para factura (RUC)
    email TEXT NOT NULL,              -- destino del CPE PDF

    -- referencia en Culqi
    culqi_customer_id TEXT,           -- 'cus_live_xxx'

    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id),
    UNIQUE (tipo_documento, numero_documento)
);

-- 3. Metodos de pago tokenizados (multiple por customer, 1 default)
CREATE TABLE IF NOT EXISTS billing.payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES billing.customers(id) ON DELETE CASCADE,

    culqi_card_id TEXT NOT NULL,      -- 'card_live_xxx' — token reusable
    brand TEXT,                       -- 'Visa', 'Mastercard'
    last4 TEXT NOT NULL,
    exp_month INTEGER,
    exp_year INTEGER,

    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (customer_id, culqi_card_id)
);

CREATE UNIQUE INDEX idx_pm_one_default_per_customer
    ON billing.payment_methods (customer_id)
    WHERE is_default = TRUE;

-- 4. Suscripciones (estado del ciclo)
CREATE TABLE IF NOT EXISTS billing.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES billing.customers(id),
    plan_id TEXT NOT NULL REFERENCES billing.plans(id),

    status TEXT NOT NULL DEFAULT 'incomplete'
        CHECK (status IN ('incomplete', 'trialing', 'active',
                          'past_due', 'canceled', 'expired')),

    current_period_start DATE,
    current_period_end DATE,
    trial_end DATE,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at TIMESTAMPTZ,

    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (customer_id, plan_id, current_period_start)
);

CREATE INDEX idx_subs_renewal_due
    ON billing.subscriptions (current_period_end)
    WHERE status = 'active' AND cancel_at_period_end = FALSE;

CREATE INDEX idx_subs_past_due
    ON billing.subscriptions (actualizado_en DESC)
    WHERE status = 'past_due';

-- 5. Facturas / boletas (CPE)
CREATE TABLE IF NOT EXISTS billing.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES billing.subscriptions(id),
    customer_id UUID NOT NULL REFERENCES billing.customers(id),

    -- montos (NUMERIC, no FLOAT)
    subtotal_pen NUMERIC(10,2) NOT NULL,
    igv_pen NUMERIC(10,2) NOT NULL,
    total_pen NUMERIC(10,2) NOT NULL,

    -- estado de cobro
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'void')),
    paid_at TIMESTAMPTZ,

    -- referencia CPE Nubefact
    cpe_tipo TEXT CHECK (cpe_tipo IN ('factura', 'boleta', 'nota_credito')),
    cpe_serie TEXT,                   -- 'F001' o 'B001'
    cpe_numero INTEGER,
    cpe_emitido_en TIMESTAMPTZ,
    cpe_xml_url TEXT,
    cpe_pdf_url TEXT,
    cpe_hash TEXT,
    cpe_error TEXT,                   -- si emision fallo, mensaje SUNAT

    -- referencia Culqi
    culqi_charge_id TEXT,             -- 'chr_live_xxx'

    periodo_desde DATE NOT NULL,
    periodo_hasta DATE NOT NULL,

    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_status_pending
    ON billing.invoices (creado_en DESC) WHERE status = 'pending';

CREATE INDEX idx_invoices_cpe_emision
    ON billing.invoices (cpe_emitido_en DESC) WHERE cpe_serie IS NOT NULL;

-- 6. Intentos de cobro (audit + dunning)
CREATE TABLE IF NOT EXISTS billing.payment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES billing.invoices(id),
    payment_method_id UUID REFERENCES billing.payment_methods(id),

    attempt_n INTEGER NOT NULL,       -- 1, 2, 3
    status TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'error')),

    culqi_charge_id TEXT,
    culqi_error_code TEXT,
    culqi_error_message TEXT,

    intentado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalizado_en TIMESTAMPTZ,

    UNIQUE (invoice_id, attempt_n)
);

-- 7. Log de webhooks (idempotencia)
CREATE TABLE IF NOT EXISTS billing.webhooks_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL CHECK (provider IN ('culqi', 'nubefact')),
    event_id TEXT NOT NULL,           -- id unico del provider
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    signature_valid BOOLEAN NOT NULL,

    procesado_en TIMESTAMPTZ,
    procesamiento_error TEXT,

    recibido_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (provider, event_id)
);
```

**Decisiones clave:**

- `subscriptions.status` separado de `invoices.status`. Suscripcion
  `active` con factura `failed` = past_due. No mezclar conceptos.
- `payment_methods` separado de `customers`. Un customer puede tener N
  tarjetas, 1 default. Permite cambio sin tocar suscripcion.
- `webhooks_log` con `UNIQUE (provider, event_id)` para idempotencia —
  si Culqi reintenta el mismo webhook, segunda llamada no hace nada.
- Montos en `NUMERIC(10,2)` no `FLOAT`. Calculo IGV redondeado al centavo.

### 4.3 Flujo de suscripcion inicial

```
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  User    │   │ Frontend │   │ Backend  │   │  Culqi   │   │ Nubefact │
└────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘
     │              │              │              │              │
     │ Elige plan   │              │              │              │
     ├─────────────►│              │              │              │
     │              │ POST /api/v1/billing/subscriptions          │
     │              │  { plan_id, customer_data }                 │
     │              ├─────────────►│              │              │
     │              │              │ Crea customer + subscription │
     │              │              │  status=incomplete            │
     │              │              │ Crea invoice                  │
     │              │              │  status=pending               │
     │              │              │◄────────────┘              │
     │              │              │                              │
     │              │ { invoice_id, public_key, amount }          │
     │              │◄─────────────┤              │              │
     │              │              │              │              │
     │              │ Monta Culqi.js Checkout     │              │
     │              ├──────────────────────────► │              │
     │ Ingresa tarjeta o Yape                    │              │
     ├─────────────────────────────────────────► │              │
     │              │              │              │              │
     │              │ token (one-time, callback) │              │
     │              │◄─────────────────────────── │              │
     │              │              │              │              │
     │              │ POST /api/v1/billing/invoices/:id/pay      │
     │              │  { culqi_token }            │              │
     │              ├─────────────►│              │              │
     │              │              │ POST /v2/customers           │
     │              │              ├─────────────►│              │
     │              │              │ customer_id  │              │
     │              │              │◄─────────────┤              │
     │              │              │ POST /v2/cards               │
     │              │              ├─────────────►│              │
     │              │              │ card_id      │              │
     │              │              │◄─────────────┤              │
     │              │              │ POST /v2/charges             │
     │              │              │  { card_id, amount }         │
     │              │              ├─────────────►│              │
     │              │              │ charge OK    │              │
     │              │              │◄─────────────┤              │
     │              │              │                              │
     │              │              │ UPDATE invoice.status='paid' │
     │              │              │ INSERT payment_attempt ok    │
     │              │              │                              │
     │              │              │ POST /api/v1/invoice         │
     │              │              ├─────────────────────────────►│
     │              │              │  { tipo, ruc/dni, items }    │
     │              │              │ CPE XML+PDF                  │
     │              │              │◄─────────────────────────────┤
     │              │              │                              │
     │              │              │ UPDATE invoice               │
     │              │              │  cpe_*, status sin cambio    │
     │              │              │ UPDATE subscription          │
     │              │              │  status='active'             │
     │              │              │ Email customer con PDF       │
     │              │ 200 ok       │                              │
     │              │◄─────────────┤              │              │
     │ Redirect /dashboard         │              │              │
     │◄─────────────┤              │              │              │
```

**Punto critico:** la emision Nubefact corre **despues** del charge OK.
Si Nubefact falla (SUNAT caido, validacion RUC), el cobro YA paso. El
invoice queda `paid` con `cpe_error` set, y un retry job intenta cada
30min. Nunca dejamos al cliente sin CPE — es responsabilidad legal nuestra.

### 4.4 Flujo de renovacion (cron)

```
GitHub Actions schedule (diario 06:00 Lima):
    POST /api/v1/billing/cron/renew

Backend:
    SELECT s.* FROM billing.subscriptions s
    WHERE s.status = 'active'
      AND s.current_period_end <= CURRENT_DATE
      AND s.cancel_at_period_end = FALSE;

    FOR cada subscription:
        1. Crear invoice nueva (status=pending, periodo siguiente)
        2. Llamar Culqi.charges con payment_method default
        3a. Si OK:
            - invoice.status = 'paid'
            - subscription.current_period_start/end += 1 mes/ano
            - Llamar Nubefact, emitir CPE
            - Email customer
        3b. Si FAIL:
            - payment_attempt registra error
            - subscription.status = 'past_due'
            - Agendar retry +1 dia
            - Email customer "cobro fallido, actualiza tarjeta"
```

### 4.5 Dunning (cobros fallidos)

Politica V1:

| Intento | Cuando | Accion si falla |
|---|---|---|
| 1 | Dia del period_end | Email "cobro fallido, reintentamos en 3 dias", status=past_due |
| 2 | +3 dias | Email "ultimo intento en 4 dias" |
| 3 | +7 dias | Email "cuenta suspendida" + status=expired, limita acceso |

Operador puede en cualquier momento: "Marcar como pagado manual",
"Cancelar suscripcion", "Reintentar ahora".

### 4.6 API endpoints nuevos

```
# Publicos (con auth de tenant)
GET    /api/v1/billing/plans
GET    /api/v1/billing/me                        → customer + subscription activa
POST   /api/v1/billing/subscriptions             → crea customer + sub + invoice
POST   /api/v1/billing/invoices/:id/pay          → recibe culqi_token, cobra
POST   /api/v1/billing/payment-methods           → agrega tarjeta nueva
DELETE /api/v1/billing/payment-methods/:id
POST   /api/v1/billing/subscriptions/:id/cancel  → cancel_at_period_end=true
GET    /api/v1/billing/invoices                  → lista, paginada
GET    /api/v1/billing/invoices/:id/pdf          → redirect a cpe_pdf_url

# Webhooks (sin auth, validados por firma)
POST   /api/v1/billing/webhooks/culqi
POST   /api/v1/billing/webhooks/nubefact

# Admin (rol admin Aibenchef)
GET    /api/v1/admin/billing/subscriptions       → filtros: status, plan
GET    /api/v1/admin/billing/invoices            → filtros: status, periodo
POST   /api/v1/admin/billing/invoices/:id/retry  → retry manual
POST   /api/v1/admin/billing/invoices/:id/refund → emite nota credito
GET    /api/v1/admin/billing/cpe-pendientes      → invoices paid sin CPE

# Cron (auth via secret header)
POST   /api/v1/billing/cron/renew
POST   /api/v1/billing/cron/retry-cpe            → reintenta Nubefact pendientes
POST   /api/v1/billing/cron/dunning              → procesa past_due
```

### 4.7 Frontend — pantallas

```
/checkout/[planId]
    Formulario customer (RUC/DNI, razon social, direccion, email)
    Culqi.js embed (tarjeta o Yape)
    Disclaimer: "Se emitira boleta/factura electronica a nombre de..."

/dashboard/billing
    Plan actual + proximo cobro
    Tarjeta default + boton "Cambiar"
    Historial facturas (descarga PDF)
    Boton "Cancelar suscripcion" (al final del periodo)

/dashboard/admin/billing                          [solo rol admin]
    Tabs: Subscripciones | Facturas | CPE pendientes | Pagos fallidos
    Tablas con filtros, export CSV mensual al contador
```

ASCII mockup del admin:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Billing / Admin                                       Mes: Mayo 2026  [▼] │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  🟢 RESUMEN MES                                                            │
│  ┌──────────────┬──────────────┬──────────────┬──────────────────────┐   │
│  │ Activas      │ Past due     │ MRR          │ CPE emitidos          │   │
│  │ 47           │ 3            │ S/. 8,450    │ 52 (49 ok, 3 pending) │   │
│  └──────────────┴──────────────┴──────────────┴──────────────────────┘   │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ⚠️ CPE PENDIENTES DE EMISION (3)                                          │
│                                                                            │
│  Invoice          Customer            Monto      Error              Acc.  │
│  INV-202605-0042  Acme SAC (RUC...)   S/. 199    RUC no validado    Retry │
│  INV-202605-0045  Beta SAC (RUC...)   S/. 99     SUNAT timeout      Retry │
│  INV-202605-0049  Gamma (DNI...)      S/. 49     -                  -    │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  💳 PAGOS FALLIDOS (3 past_due)                                            │
│                                                                            │
│  Sub               Customer        Plan       Falla       Reintentos  Acc │
│  sub_xxx           Acme SAC        Pro Anual  Card decl.  2/3         ... │
│  ...                                                                       │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## 5. Plan de implementacion

Dividido en **4 PRs** secuenciales:

### PR-A — Schema + seed de planes
- Migracion `V<N>_billing_initial.sql` (todas las tablas de 4.2)
- Seed inicial `V<N+1>_billing_plans_seed.sql` con planes definitivos
- Tests de migracion (idempotencia, rollback)

### PR-B — Integracion Culqi
- Cliente Python `aibenchef_data.billing.culqi_client`
- Endpoints: crear customer, crear card, cobrar, manejar webhook
- Validacion de firma HMAC en webhook
- Tests con mock de Culqi (no llamadas reales en CI)
- Test integracion con cuenta sandbox Culqi (job separado, opcional)

### PR-C — Integracion Nubefact + retry CPE
- Cliente Python `aibenchef_data.billing.nubefact_client`
- Endpoint emision tras charge ok
- Cron retry de CPE pendientes (cada 30min)
- Tests con sandbox Nubefact

### PR-D — Frontend + dunning + admin
- Pantalla `/checkout/[planId]` con Culqi.js
- Pantalla `/dashboard/billing` (customer view)
- Pantalla `/dashboard/admin/billing` (admin view)
- Cron renovacion + cron dunning
- Plantillas email (Resend)
- Export CSV mensual al contador

## 6. Definition of Done

Por DoD del proyecto (`.claude/rules/definition-of-done.md`):

- [ ] 4 PRs mergeados con CI verde
- [ ] Ruff check + format clean
- [ ] Tests cubren: happy path checkout → charge ok → CPE emitido;
      checkout con tarjeta declinada → invoice failed; renovacion ok;
      renovacion fallida → past_due; webhook duplicado → idempotente
- [ ] Migracion SQL idempotente (`CREATE IF NOT EXISTS`)
- [ ] **Sin secrets en repo**: `CULQI_SECRET_KEY`, `NUBEFACT_TOKEN`,
      `RESEND_API_KEY` solo en EasyPanel env vars
- [ ] **AzoraTech SAC afiliada al SEE** via PSE Nubefact en SUNAT (clave SOL → Empresas → Comprobantes de Pago → SEE → Afiliacion via PSE). Sin esto, NO se puede emitir
- [ ] Cuenta Culqi en modo `live` con webhook configurado a
      `https://aibenchef.com/api/v1/billing/webhooks/culqi`
- [ ] Cuenta Nubefact con RUC AzoraTech (20614399555) cargado, series F001
      y B001 autorizadas en SUNAT
- [ ] Documentacion: agregar seccion al README del backend con
      "Como agregar un plan nuevo" y "Como hacer reembolso manual"
- [ ] Comentarios y mensajes UI en castellano peruano
- [ ] Smoke test E2E manual antes de abrir publico:
      1 customer real (gussbrav) compra plan, recibe PDF, ve dashboard
- [ ] Aviso al contador externo de Azoramind: nuevo flujo de emision,
      donde estan los XML del mes

## 7. Riesgos & mitigaciones

| Riesgo | Mitigacion |
|---|---|
| **AzoraTech no es emisor electronico todavia** (SEE vacio en SUNAT al 2026-05-31) | Bloqueante real: hay que afiliar al SEE via Nubefact (PSE) en SUNAT Operaciones en Linea ANTES de empezar PR-C. Toma 1-3 dias habiles. No bloquea PR-A ni PR-B (schema + Culqi) |
| **Detraccion 12% sobre servicios de programacion (Actividad CIIU 6201)** si operacion B2B con RUC > S/.700 | Ver seccion 12 "Detraccion" abajo. Decision de negocio que afecta diseño del checkout |
| Charge OK + Nubefact falla → cliente paga sin CPE | Retry cada 30min, alerta admin a las 6h, emision manual desde UI Nubefact como fallback |
| Webhook Culqi duplicado | `UNIQUE (provider, event_id)` en `webhooks_log`, segundo INSERT falla y NO reprocesamos |
| Tarjeta expirada mid-suscripcion | Dunning email 14 dias antes de exp_year/exp_month, link a actualizar PM |
| Cliente cambia RUC mid-mes | Customer puede editar datos. CPE futuro usa nuevos datos. CPE pasados quedan con datos viejos (correcto legalmente) |
| Culqi sube comision sin aviso | Monto que cobramos al cliente es bruto; comision sale de nuestro margen. Revisar trimestralmente |
| SUNAT cae y Nubefact tambien | CPE queda `pending`; ley permite emitir en hasta 7 dias. Si pasa eso → emision masiva manual + alerta a contador |
| Reembolso parcial necesario | V1 = solo total via nota de credito manual. Operador emite desde nubefact.com y carga `nota_credito_url` en invoice |
| Yape no funciona en algunos devices | Culqi Yape requiere callback URL; testear flujo en Android antes de release |
| Cron renovacion falla silencioso | `carga_log` (del doc V1 de observability) registra cada corrida. Alerta si no corrio en 25h |

## 8. Rollback

- Migraciones aditivas (schema nuevo `billing`). Drop schema CASCADE si
  hay que revertir antes de tener customers reales.
- Si hay customers reales y rollback urgente: deshabilitar checkout
  frontend (feature flag), mantener cron de renovacion (cumplir contrato),
  pausar emision nueva via flag `BILLING_ENABLED=false`.
- Webhooks: dejar endpoints respondiendo 200 OK aunque no procesen, para
  no triggear reintentos Culqi.

## 9. Metricas de exito

Tras 90 dias en produccion:
- Tasa exito cobro inicial: **>95%**
- Tasa exito renovacion: **>97%**
- Tiempo emision CPE post-charge: **p95 < 60s**
- Tasa CPE rechazados por SUNAT: **<1%**
- Tickets soporte/billing por mes: **<3**
- Tiempo cuadre contable mensual (operador → contador): **<30min**

## 10. Apendice — Evolucion del stack de billing

Aibenchef no va a usar Odoo desde dia 1. Pero hay puntos de inflexion
donde el stack de V1 deja de escalar y migrar es la decision correcta.

### Fase 1 — MVP (0–50 customers)
**Stack:** PostgreSQL `billing.*` + Culqi + Nubefact + cron GH Actions.
**Tiempo dev inicial:** ~2 semanas.
**Tiempo operativo/mes:** ~30min (cuadre con contador).
**Cuando dejar esta fase:** ver triggers Fase 2.

### Fase 2 — Crecimiento (50–500 customers)
**Stack:** mismo, + dashboard admin mas serio + Stripe en paralelo si
hay clientes USD + integracion con CRM (HubSpot/Pipedrive) si hay sales.
**Tiempo dev incremental:** ~3 semanas.
**Cuando dejar esta fase:** ver triggers Fase 3.

### Fase 3 — Escala (500+ customers o multi-producto)
**Stack:** Migrar a Bsale (PYME peruano) o Defontana (medianas empresas).
Reemplaza Nubefact (modulo emision integrado) y `billing.invoices`
(modulo facturacion). Mantenemos Culqi como pasarela.
Alternativa: **Odoo Enterprise con `l10n_pe`** si queremos CRM + RRHH +
contabilidad en mismo sistema.

### Triggers para migrar de fase

| Trigger | De fase | A fase |
|---|---|---|
| Operador dedica >2h/semana a billing manual | 1 | 2 |
| Aparecen casos no soportados (prorrateo fino, addons, descuentos por volumen) | 1 | 2 |
| Primer cliente USD pide invoice internacional | 1 | 2 (Stripe parallel) |
| MRR > S/.50k OR >100 facturas/mes | 2 | 3 |
| Necesitas RRHH/inventario/compras en mismo sistema | 2 | 3 (Odoo) |
| Contador externo se vuelve cuello de botella | 2 | 3 |
| Plan de oferta publica de acciones / auditoria externa | 2 | 3 |

### Portabilidad de datos

El schema `billing.*` esta disenado para ser exportable a cualquier ERP:

```sql
-- Export que entendera Bsale/Defontana/Odoo:
SELECT
    c.razon_social, c.tipo_documento, c.numero_documento, c.direccion,
    i.cpe_serie, i.cpe_numero, i.cpe_emitido_en,
    i.subtotal_pen, i.igv_pen, i.total_pen,
    p.nombre AS plan_nombre, i.periodo_desde, i.periodo_hasta
FROM billing.invoices i
JOIN billing.customers c ON c.id = i.customer_id
JOIN billing.subscriptions s ON s.id = i.subscription_id
JOIN billing.plans p ON p.id = s.plan_id
WHERE i.status = 'paid';
```

Esto se mapea 1-a-1 a:
- **Bsale:** modulo Ventas → Documentos electronicos
- **Defontana:** modulo Cobranza → Comprobantes
- **Odoo:** `account.move` + `res.partner`

**Regla de oro:** empezar simple con campos genericos (razon_social,
documento, items), evitar campos especificos de Culqi/Nubefact en
modelos de dominio. Esos van solo en tablas `*_attempts` y `webhooks_log`.

## 11. Anexo — Casos cubiertos por V1

| Caso | Como lo maneja V1 |
|---|---|
| Cliente paga con tarjeta peruana | Culqi charge → CPE Nubefact → email |
| Cliente paga con Yape | Culqi Yape callback → mismo flujo |
| Cliente da RUC | CPE tipo factura, serie F001 |
| Cliente da DNI | CPE tipo boleta, serie B001 |
| Renovacion automatica mensual/anual | Cron diario + Culqi recurring charge |
| Tarjeta declinada en renovacion | past_due + dunning (3 intentos en 7 dias) |
| Cliente cancela | cancel_at_period_end=true; sigue activo hasta period_end |
| Cliente actualiza tarjeta | POST /payment-methods, set is_default=true |
| Emision CPE falla por SUNAT down | Retry cron cada 30min, manual fallback desde admin |
| Cliente cambia plan | V1: cancelar actual + crear nueva. Sin prorrateo |
| Reembolso total | Manual: admin emite nota credito desde UI Nubefact + carga ref en invoice |
| Reembolso parcial | **NO cubierto en V1** |
| Pago internacional USD | **NO cubierto en V1** (Stripe en V2) |
| Plan con creditos consumibles | **NO cubierto en V1** |
| Comprobante a empresa con CxC 30/60 dias | **NO cubierto en V1** |

## 12. Apendice — Detraccion 12% (SPOT)

AzoraTech tiene CIIU principal **6201 — Programacion Informatica**. Los
servicios facturados bajo esta actividad caen en el regimen de
**detraccion del 12%** (Sistema de Pago de Obligaciones Tributarias —
Anexo 3 R.S. 183-2004/SUNAT y modificatorias, "Demas servicios gravados
con IGV") cuando la operacion B2B con cliente RUC supera **S/.700**.

### Que implica operativamente

Sin detraccion (B2C con DNI, o B2B < S/.700):
```
Cliente paga total           → S/.1180 (1000 + IGV)
Culqi cobra                   → S/.1180
Culqi liquida (- comision)    → ~S/.1133 a cuenta AzoraTech
AzoraTech registra ingreso    → S/.1180 (CPE total)
```

Con detraccion (B2B con RUC, monto > S/.700):
```
Cliente paga total            → S/.1180
Cliente DEBE depositar 12%    → S/.142 en cuenta detraccion BN AzoraTech
Cliente paga al proveedor     → S/.1038 (88%)

Problema: Culqi cobra TODA la tarjeta (S/.1180), no sabe del split.
El 12% retenible queda como pasivo de AzoraTech con el cliente:
  - O AzoraTech transfiere ese 12% al cliente para que lo deposite (engorroso)
  - O AzoraTech emite nota de credito y re-emite por 88% (rompe legalidad)
  - O Culqi cobra solo 88% y cliente deposita el 12% por su lado
    (requiere flujo customizado en checkout)
```

### Opciones de diseño

| Opcion | Como | Tradeoff |
|---|---|---|
| **A. Planes por debajo del umbral** | Plan mensual maximo S/.700 incluyendo IGV (= ~S/.593 + IGV). Plan anual: fraccionar mensual O cobrar el primer mes y autoinvoicing despues | Limita ARPU. Plan anual sin descuento real |
| **B. Solo B2C (DNI) en V1** | Checkout solo acepta tipo_documento=DNI. Persona natural no esta sujeta a detraccion | Pierde 100% del segmento empresarial. Para SaaS B2B (que es el caso natural de Aibenchef) es muy restrictivo |
| **C. B2B con flujo split en checkout** | Si tipo_documento=RUC AND total > S/.700: Culqi cobra solo 88%, el checkout muestra al cliente la instruccion "deposita el 12% en cuenta detraccion BN xxxx-xxxxx-xx-xx" + numero de operacion como referencia. Backend monitorea deposito via reconciliacion manual mensual | Mejor experiencia legal pero peor UX (cliente debe hacer 2 pagos). Riesgo: cliente no deposita su 12% → AzoraTech tiene contingencia |
| **D. Asumir detraccion como costo** | Culqi cobra 100%. AzoraTech emite CPE total. Cliente paga el 100% pero NO deposita detraccion. AzoraTech declara y paga la detraccion a SUNAT desde su propio bolsillo del 12% | NO ES LEGAL — la detraccion la deposita el adquirente (cliente), no el proveedor. SUNAT puede multar |

### Recomendacion V1

**Opcion A si vamos B2B + B2C, Opcion B si vamos solo B2C.**

La opcion C es la "correcta legalmente" pero rompe el flujo automatizado
y agrega friccion al checkout que va a matar conversion. Para V1 simple:

- Plan **Starter**: S/.99/mes (B2C-friendly, < S/.700)
- Plan **Pro**: S/.299/mes (B2C+B2B, < S/.700)
- Plan **Enterprise**: cotizacion manual con factura externa
  + deposito detraccion (no se ofrece en checkout publico)

Si hay demanda B2B > S/.700, abrir esa via en V2 con flujo C.

### Que necesito de vos para cerrar esto

1. **Rango de precio objetivo** — si los planes que tenes en mente caen
   debajo de S/.700, problema resuelto.
2. **Mix B2B/B2C esperado** — si 80% va a ser empresa con RUC, repensar
   antes de codear.
3. **Cuenta de detracciones en Banco de la Nacion** — abrirla igual
   (toma 2 dias) por si Enterprise plan o por defensa fiscal. No
   bloquea V1 si todos los planes son < S/.700.

---

**Aprobacion requerida antes de implementar.**
Comentarios / cambios al doc → editar este archivo y pedir nuevo review.
