# Cron diario SBS

Sincronización automática diaria de archivos SBS — scrape + import + quality-check.

## Componentes

| Archivo | Path en server | Propósito |
|---|---|---|
| `aibenchef-daily-sync.sh` | `/usr/local/bin/aibenchef-daily-sync.sh` | Script principal (queue + work + dump + quality-check + drift). Corre **3x al día** |
| `aibenchef-daily` (cron) | `/etc/cron.d/aibenchef-daily` | Schedule 06:00, 14:00, 22:00 Lima (= 11, 19, 03 UTC) |
| **`aibenchef-work-jobs.sh`** | `/usr/local/bin/aibenchef-work-jobs.sh` | **Script liviano: solo procesa la cola de sync_jobs pending. Corre cada 5 min** |
| **`aibenchef-work-jobs`** (cron) | `/etc/cron.d/aibenchef-work-jobs` | **Schedule `*/5 * * * *` — reduce la latencia "user encola desde UI → worker procesa" de 8h a 5 min max** |
| `aibenchef-expire-plans.sh` | `/usr/local/bin/aibenchef-expire-plans.sh` | **Downgrade auto de trials + planes pagados vencidos. `auth.expire_trials()` + `auth.expire_paid_plans()`** |
| `aibenchef-expire-plans` (cron) | `/etc/cron.d/aibenchef-expire-plans` | Schedule `0 4 * * *` (04:00 UTC = 23:00 Lima). Corre diario |
| `aibenchef-reconcile-ratios.sh` | `/usr/local/bin/aibenchef-reconcile-ratios.sh` | **QA de metodologia: compara ROA/ROE/Mora nuestros vs SBS oficial (`gov.reconcile_ratios`)** |
| `aibenchef-reconcile-ratios` (cron) | `/etc/cron.d/aibenchef-reconcile-ratios` | Schedule `30 3 * * *` (03:30 UTC). Corre diario post-medianoche |
| `aibenchef-reverify-sbs.sh` | `/usr/local/bin/aibenchef-reverify-sbs.sh` | **Encola sync_jobs para archivos SBS marcados 'no_publicado_sbs' vencidos (V178 `v_no_publicados_reverificables`)** |
| `aibenchef-reverify-sbs` (cron) | `/etc/cron.d/aibenchef-reverify-sbs` | Schedule `15 */6 * * *` (cada 6h). Cap 20 jobs/corrida |
| `aibenchef` (logrotate) | `/etc/logrotate.d/aibenchef` | Rotación mensual de logs, retiene 12 meses |
| Logs | `/var/log/aibenchef/{daily-sync,work-jobs,expire-plans,reconcile-ratios,reverify-sbs}-YYYY-MM-DD.log` | Output completo por script |

## Instalación en el servidor EasyPanel

```bash
# 1. Copiar scripts a /usr/local/bin/
sudo cp aibenchef-daily-sync.sh        /usr/local/bin/
sudo cp aibenchef-work-jobs.sh         /usr/local/bin/
sudo cp aibenchef-expire-plans.sh      /usr/local/bin/
sudo cp aibenchef-reconcile-ratios.sh  /usr/local/bin/
sudo cp aibenchef-reverify-sbs.sh      /usr/local/bin/
sudo chmod +x /usr/local/bin/aibenchef-*.sh

# 2. Instalar los 5 crons
sudo cp aibenchef-daily                /etc/cron.d/
sudo cp aibenchef-work-jobs            /etc/cron.d/
sudo cp aibenchef-expire-plans         /etc/cron.d/
sudo cp aibenchef-reconcile-ratios     /etc/cron.d/
sudo cp aibenchef-reverify-sbs         /etc/cron.d/
# Reload cron (no siempre necesario pero seguro)
sudo systemctl reload cron 2>/dev/null || sudo service cron reload

# 3. Verificar que quedaron instalados
sudo ls -la /etc/cron.d/aibenchef*
tail -f /var/log/aibenchef/work-jobs-$(date -u +%Y-%m-%d).log
```

## Por qué 2 crons

- **daily-sync (3x/día)**: pipeline COMPLETO — descubrir periodos nuevos, descargar,
  importar, dump grid, quality checks, drift monitoring. Es pesado (~5-10 min por
  corrida) y no tiene sentido correrlo cada 5 min.
- **work-jobs (cada 5 min)**: SOLO procesa `admin.sync_jobs` pending. Es liviano
  (~0-30 seg si hay jobs, 0 seg si no hay). Reduce a 5 min la latencia entre que
  el user hace click en "Forzar re-descarga" en `/dashboard/admin/data-quality`
  y el worker efectivamente descarga los archivos.

## Pipeline diario

```
┌──────────────────────────────────────────────────────────┐
│  [1/4] queue-monthly (sliding window + retry, idemp.)    │
│  → encola los ultimos 3 meses (default --months-back=3)  │
│  → re-encola periodos con archivos no_publicado_sbs      │
│    actualizados hace < 90 dias (publicacion tardia SBS)  │
│  → NO duplica jobs pending/running del mismo periodo     │
├──────────────────────────────────────────────────────────┤
│  [2/4] work-jobs --max-jobs 10                           │
│  → scrape SBS (http_downloader)                          │
│  → escribe a /app/local-data/raw/<grupo>/<topico>/...    │
│  → storage scan: tamanio/formato/status (fix #126)       │
│    si tamanio >= 2KB y era no_publicado -> 'descargado'  │
│  → import all-monthly --periodo X (fix #126)             │
│    procesa los 10 topicos: status 'descargado'->'procesado'│
│  → archivo final: procesado | descargado | no_publicado  │
├──────────────────────────────────────────────────────────┤
│  [3/4] dump_archivo_contenido --skip-existing            │
│  → parsea .xls nuevos y vuelca grid a raw.archivo_contenido│
│  → alimenta el visor Grid del Inspector de Tópicos (#65) │
├──────────────────────────────────────────────────────────┤
│  [4/4] quality-check (últimos 2 meses)                   │
│  → balance_contable + outlier_zscore + suma_subcuentas   │
│  → auto-resolve (PR #44) limpia stale anomalies          │
└──────────────────────────────────────────────────────────┘
```

## Instalación en server (one-time)

```bash
# 1. Copiar script
sudo cp aibenchef-daily-sync.sh /usr/local/bin/
sudo chmod 755 /usr/local/bin/aibenchef-daily-sync.sh

# 2. Cron
sudo cp aibenchef-daily /etc/cron.d/
sudo chmod 644 /etc/cron.d/aibenchef-daily

# 3. Logrotate
sudo cp aibenchef-logrotate /etc/logrotate.d/aibenchef

# 4. Permisos del bind volume (uid 1001 = container user)
sudo chown -R 1001:1001 /etc/easypanel/projects/azoramind/aibenchef-data/raw
```

## Operación

### Ver logs
```bash
tail -f /var/log/aibenchef/daily-sync-$(date -u +%Y-%m-%d).log
```

### Run manual (debug)
```bash
sudo /usr/local/bin/aibenchef-daily-sync.sh
```

### Ver jobs pendientes
```sql
SELECT id, periodo_desde, periodo_hasta, status, error_mensaje, requested_at, completed_at
  FROM admin.sync_jobs
 ORDER BY id DESC LIMIT 10;
```

## Comportamiento esperado

| Caso | Resultado |
|---|---|
| SBS publicó el mes esperado | `status='descargado'` → import → quality-check detecta nuevas anomalías |
| SBS NO publicó todavía | `status='no_publicado_sbs'` (tamaño 0 bytes) → import skip → quality-check 0 anomalías para ese periodo |
| Archivo corrupto en SBS | `status='error'` con `error_mensaje` → cron continúa con el siguiente |
| Sin cambios (md5 igual al previo) | `status='descargado'` pero `archivos_cambiados=0` → import skip |
