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

### A) Cron mensual (recomendado)

En EasyPanel, agregar dos cron jobs al contenedor `aibenchef-data-platform`:

```cron
# Día 25, 02:00 AM: encolar job de sincronización del mes anterior
0 2 25 * *   cd /app && aibenchef sbs queue-monthly

# Cada hora a partir de las 03:00 AM del 25: procesar jobs pendientes
0 3-23 25 * * cd /app && aibenchef sbs work-jobs
0 * 26-31 * * cd /app && aibenchef sbs work-jobs
```

`queue-monthly` encola un job para el mes anterior. `work-jobs` toma jobs `pending` y los procesa (scrape + detect md5 changes + import).

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

1. **Día 25** 02:00 AM — cron dispara `queue-monthly` → inserta job para mes anterior
2. **Día 25** 03:00 AM — cron dispara `work-jobs`:
   - toma el job, status → `running`
   - ejecuta `scrape --desde X --hasta X` (todos los tópicos)
   - ejecuta `storage scan` (actualiza md5_hash)
   - status → `completed`, log_text con summary
3. **Dashboard `/admin/archivos`** muestra la celda Mes/Año con color verde (procesado)
4. Si la SBS reemplaza un archivo después del cron, el siguiente `storage scan` detecta md5 distinto → posible re-procesamiento

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
