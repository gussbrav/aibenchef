# Cron diario SBS

Sincronización automática diaria de archivos SBS — scrape + import + quality-check.

## Componentes

| Archivo | Path en server | Propósito |
|---|---|---|
| `aibenchef-daily-sync.sh` | `/usr/local/bin/aibenchef-daily-sync.sh` | Script principal que orquesta el sync |
| `aibenchef-daily` (cron) | `/etc/cron.d/aibenchef-daily` | Schedule **3x al día**: 06:00, 14:00, 22:00 Lima (= 11, 19, 03 UTC) |
| `aibenchef` (logrotate) | `/etc/logrotate.d/aibenchef` | Rotación mensual de logs, retiene 12 meses |
| Logs | `/var/log/aibenchef/daily-sync-YYYY-MM-DD.log` | Output completo del run |

## Pipeline diario

```
┌──────────────────────────────────────────────────────────┐
│  [1/3] queue-monthly                                     │
│  → admin.sync_jobs INSERT job (mes anterior, idempotente)│
├──────────────────────────────────────────────────────────┤
│  [2/3] work-jobs --max-jobs 10                           │
│  → playwright scrape SBS                                 │
│  → escribe a /app/local-data/raw/<grupo>/<topico>/...    │
│  → status archivo: descargado | no_publicado_sbs | error │
│  → import monthly-eeff de archivos con status descargado │
├──────────────────────────────────────────────────────────┤
│  [3/3] quality-check (últimos 2 meses)                   │
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
