# regen-hero-mockup

Regenera el mockup del hero del landing (`aibenchef.azoramind.com`) con el
último cierre publicado por el regulador. Se corre después de cada ingesta
mensual manual.

## Por qué existe

`components/marketing/dashboard-mockup.tsx` renderiza una tabla que muestra
el "Cuadro Resumen" real de los top 5 bancos peruanos al último cierre.
Antes la data estaba hardcoded — cada nuevo mes el landing quedaba stale
("Cierre Jun 2026" mientras SBS ya había publicado Sep 2026).

Este script queryea prod, arma el JSON con el nuevo cierre, y lo escribe a
`components/marketing/dashboard-mockup-data.json`. El componente importa
el JSON directo, así el landing siempre refleja lo último sin editar código.

## Cuándo correrlo

**Después de cada ingesta manual mensual** (ver `project_ingestion_manual`
en memoria). Flujo completo:

```bash
cd data-platform
uv run aibenchef scrape --periodo YYYYMM
uv run aibenchef import monthly-eeff ./local-data/raw
uv run aibenchef catalog normalize-entidades
uv run aibenchef db refresh-mvs --concurrently

# ↓ NUEVO paso
cd ../apps/web
DATABASE_URL="postgres://user:pass@host:5432/aibenchef" pnpm regen-hero
git commit -am "chore(landing): actualizar mockup cierre YYYYMM"
git push origin production
# dispara deploy manual EasyPanel
```

## Cómo correrlo

**Preview sin escribir** (recomendado antes del commit):

```bash
pnpm regen-hero:dry
```

Imprime el JSON generado en stdout sin tocar el file.

**Escribir el JSON** (después de validar el dry-run):

```bash
pnpm regen-hero
```

**Forzar un periodo específico** (útil si SBS republicó un cierre viejo):

```bash
pnpm regen-hero -- --periodo 202607
```

**Override del peer group** (default es top 5 bancos por cartera):

```bash
pnpm regen-hero -- --peer-group "BCP,BBVA,Interbank,Scotiabank,Pichincha"
```

## Conectividad DATABASE_URL

Postgres prod está en Docker Swarm interno del Hetzner. Desde la laptop
de Gustavo/JJ hay 2 formas de correr:

**Opción A — Túnel SSH temporal** (recomendado):

```bash
# En una terminal aparte, abrir túnel al Postgres del server:
ssh -L 55432:localhost:5432 root@46.224.250.197 \
    -i "D:/PROYECTO/N8N/Azoramind/.ssh/id_rsa" -N &

# En otra terminal, correr con DATABASE_URL apuntando al túnel local:
DATABASE_URL="postgres://postgres:PASSWORD@localhost:55432/aibenchef" pnpm regen-hero
```

Cuando termine, cerrar el túnel con `kill %1` o similar.

**Opción B — Correr en el server via SSH**:

```bash
ssh root@46.224.250.197 "cd /path/aibenchef/apps/web && DATABASE_URL=... pnpm regen-hero"
```

Requiere que el repo esté clonado en el server (probablemente no lo está
aún — Opción A es más práctica).

## Fail-safe

El script está diseñado para NO romper el landing:

- Si `DATABASE_URL` falta → exit code 2, JSON intacto
- Si la query falla → exit code 2, JSON intacto
- Si la data nueva tiene menos entidades o valores todos-cero → exit code 2, JSON intacto
- Si el periodo nuevo es anterior al actual → exit code 2, JSON intacto (usar `--periodo` explícito para forzar rollback)

Solo si TODO pasa, sobreescribe el JSON.

## Qué queda en el JSON

```json
{
  "generatedAt": "2026-09-01T14:30:00.000Z",
  "generatedBy": "regen-hero-mockup script (gustavo)",
  "periodo": 202608,
  "periodoLabel": "Ago 2026",
  "grupoSbs": "Banca Múltiple",
  "propiaIdx": 0,
  "entidades": ["BCP", "BBVA", "Interbank", "Scotiabank", "Pichincha"],
  "filas": [
    { "label": "Cartera Bruta (MM S/)", "seccion": "cartera", "valores": [...], "format": "moneda_mm", "signo": 1 },
    ...
  ]
}
```

El componente `dashboard-mockup.tsx` valida el shape via TypeScript strict —
si el JSON queda malformado, el build falla y el deploy se aborta antes de
llegar a producción.

## Consumers del JSON

Cualquier componente que necesite el periodo del mockup debe importar
`MOCKUP_META` desde `components/marketing/dashboard-mockup.tsx`:

```tsx
import { MOCKUP_META } from "@/components/marketing/dashboard-mockup";

// MOCKUP_META.periodo         → 202608
// MOCKUP_META.periodoLabel    → "Ago 2026"
// MOCKUP_META.grupoSbs        → "Banca Múltiple"
// MOCKUP_META.entidadPropia   → "BCP"
```

Así actualizar el JSON refleja el nuevo cierre en TODO el sitio (hero
caption, demo metadata, FAQ counts) sin editar múltiples archivos.
