# Storage de archivos SBS + Sincronización automática

Este documento explica:
1. Cómo se almacenan los .xls descargados de la SBS
2. Cómo configurar persistencia en EasyPanel (volumen)
3. Cómo funciona la sincronización mensual (cron + botón manual)

---

## 1. Inventario de archivos

Tabla maestra: **`raw.archivos_descargados`** — una fila por cada .xls descargado.

Columnas clave:
- `grupo, topico, periodo, anio, mes` — identidad del archivo
- `path_local, source_url, nombre_archivo`
- `tamanio_bytes, md5_hash, formato (biff/oox/etc)`
- `status` — `descargado | procesando | procesado | error | omitido`
- `filas_insertadas` — # filas que el importer metió a raw.*
- `descargado_en, procesado_en, actualizado_en` — timestamps

Para refrescar el inventario manualmente:
```bash
aibenchef storage scan --root ./local-data/raw
```
Idempotente: actualiza md5_hash si el archivo cambió.

---

## 2. Storage físico

### Opción elegida: Volumen persistente en EasyPanel

**Setup en EasyPanel:**
1. Panel del servicio `aibenchef-data-platform` → tab **Mounts**.
2. Agregar volumen:
   - **Type**: `Volume` (persistente)
   - **Name**: `sbs-raw-data`
   - **Mount Path**: `/app/local-data`
3. Reiniciar el servicio.

Esto crea un volumen Docker persistente. Todos los .xls quedan ahí aún si el contenedor se reconstruye. Backup vía snapshot del volumen.

### Variable de entorno (opcional)

Si quieres que el path sea configurable:
```env
SBS_RAW_ROOT=/app/local-data/raw
```

El CLI lo respeta automáticamente en `aibenchef scrape` y `storage scan`.

---

## 3. Sincronización mensual automatizada

La SBS publica datos del mes anterior **entre los días 20-25** de cada mes. Y a veces **reemplaza archivos viejos** con correcciones (mismo nombre, distinto contenido).

Para detectar y manejar esto, la plataforma usa una **cola de jobs** en `admin.sync_jobs`.

### A) Cron diario 3x/día (recomendado)

Configurado en `infrastructure/cron/aibenchef-daily-sync.sh`, instalado en `/etc/cron.d/aibenchef-daily`:

```cron
# 11:00, 19:00, 03:00 UTC  =  06:00, 14:00, 22:00 Lima
0 11,19,3 * * * root /usr/local/bin/aibenchef-daily-sync.sh
```

El script ejecuta `aibenchef sbs queue-monthly && aibenchef sbs work-jobs --max-jobs 10`.

**`queue-monthly` (fix de issue #126):**

- **Ventana deslizante** — encola los últimos `--months-back` meses (default **3**). SBS publica con retraso variable de 30-45 días: si el cron solo encolara el mes anterior, archivos que aparezcan tarde quedarían en `no_publicado_sbs` para siempre.
- **Retry no_publicado_sbs** — busca periodos cuyos archivos quedaron `no_publicado_sbs` y se registraron hace menos de `--retry-no-publicado-days` días (default **90**), y los re-encola.
- **Idempotente** — si ya hay un job `pending` o `running` para un periodo, no lo duplica. El cron 3x/día no genera duplicados.

`work-jobs` toma jobs `pending` y los procesa (scrape + detect md5 changes + import).

### B) Sincronización manual desde dashboard

`/dashboard/admin/archivos` → panel "**↻ Sincronizar con SBS**":
1. Selecciona período desde/hasta (YYYYMM).
2. Selecciona tópicos (vacío = todos).
3. Click "Encolar Sincronización".

El endpoint `POST /api/v1/admin/sync-sbs` inserta el job. El worker lo toma en la siguiente ejecución del cron.

Para procesar inmediatamente desde el servidor:
```bash
aibenchef sbs work-jobs
```

### C) Detección de cambios (md5)

Cada vez que `storage scan` registra un .xls, computa `md5_hash`. Si el archivo ya existía y el hash cambió → la SBS reemplazó el contenido → re-procesar para actualizar marts.

Estados de archivo:
- `descargado` — bajado de SBS pero aún no importado
- `procesado` — importado correctamente (filas insertadas en raw.*)
- `error` — falló el import
- `omitido` — formato no soportado

---

## 4. Flujo end-to-end de un día normal

1. **Cada 8 horas** (06:00, 14:00, 22:00 Lima) — cron dispara `aibenchef-daily-sync.sh`:
   - `queue-monthly` encola los últimos 3 meses + periodos con archivos `no_publicado_sbs` recientes (idempotente: no duplica pending/running)
   - `work-jobs --max-jobs 10` procesa los jobs:
     - toma cada job, status → `running`
     - ejecuta `scrape --desde X --hasta X` (todos los tópicos)
     - ejecuta `storage scan` (actualiza md5_hash)
     - status → `completed`, `log_text` con summary
   - `dump_archivo_contenido --skip-existing` vuelca grid de archivos nuevos
   - `quality-check` los últimos 2 períodos
2. **Dashboard `/admin/archivos`** refleja el estado actualizado
3. Si SBS publica un archivo tardíamente (días/semanas después), el sliding window lo capturará en la siguiente corrida del cron sin intervención manual

---

## 5. Operaciones útiles

```bash
# Ver últimos jobs
psql -c "SELECT id, periodo_desde, periodo_hasta, status, triggered_by, requested_at FROM admin.sync_jobs ORDER BY id DESC LIMIT 20"

# Re-encolar un job fallido
psql -c "UPDATE admin.sync_jobs SET status='pending', started_at=NULL, completed_at=NULL WHERE id=42"

# Forzar re-import de un periodo (sin re-descargar)
aibenchef import monthly-eeff ./local-data/raw/banca_multiple/eeff/2026/03

# Inspeccionar un .xls problemático
aibenchef inspect xls ./local-data/raw/banca_multiple/eeff/2026/03/B-0001-ma2026.xls
```
