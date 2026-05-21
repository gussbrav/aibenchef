# Runbook — Ingestion mensual SBS fallida

## Sintomas

- GitHub Action `monthly-sbs-ingestion` falla.
- Slack alert en `#sbs-ingestion-alerts`.
- Tabla `audit.ingestion_failures` con rows nuevas.

## Diagnostico rapido

```bash
# 1. Ver logs ultimo run
gh run list --workflow=monthly-sbs-ingestion --limit 5
gh run view <run-id> --log

# 2. Ver que entidades/topicos fallaron
psql $DATABASE_URL_PROD -c "
  SELECT periodo_id, entidad_codigo, topico, error_message
  FROM audit.ingestion_failures
  WHERE created_at > now() - interval '7 days'
  ORDER BY created_at DESC LIMIT 50;
"
```

## Causas comunes

### 1. SBS cambio layout web (mas frecuente)
- Diagnostico: scraper recibe HTML pero no encuentra los selectores.
- Fix: actualizar `data-platform/scrapers/sbs/catalogo.py` con nuevos selectores.
- Re-run: `gh workflow run monthly-sbs-ingestion --field periodo=YYYYMM`.

### 2. SBS aun no publico el mes
- Diagnostico: errores 404 en URLs esperadas.
- Fix: verificar https://www.sbs.gob.pe/estadisticas-y-publicaciones manualmente.
- Re-run cuando publiquen. NO marcar como fallo critico.

### 3. Postgres lleno
- Diagnostico: `pg_size_pretty(pg_database_size('aibenchef'))` cerca del limite.
- Fix: agregar storage en provider, o archivar particiones antiguas.

### 4. Cube cache invalido
- Diagnostico: dashboards muestran data vieja tras run exitoso.
- Fix: `curl -X POST $CUBE_URL/cubejs-api/v1/pre-aggregations/jobs?action=post -d '{...refresh}'`.

## Comunicacion

- Si la falla afecta dashboards visibles a clientes pagantes: post en status page + email a tier Business+.
- Si es un blip: solo log interno.
