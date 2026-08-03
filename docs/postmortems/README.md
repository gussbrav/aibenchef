# Postmortems

Analisis de incidentes criticos con lecciones aprendidas y controles preventivos.

## Convencion

- Un archivo por incidente con formato `YYYY-MM-<slug>.md`.
- Escribir mientras la evidencia esta fresca (mismo dia o al siguiente).
- Incluir siempre: resumen ejecutivo, timeline, root cause (5 whys), lecciones,
  controles agregados, riesgos residuales.
- Enlazar controles y funciones especificas del codigo con `[archivo.py:linea](ruta)`
  para que futuros lectores puedan navegar.

## Indice

| Fecha | Incidente | Impacto | Postmortem |
|---|---|---|---|
| 2026-08-01 | C-4103-my2026.xls truncado — EDPYMEs sin ER en 202605 | 4 EDPYMEs sin Utilidad/ROE/ROA/PE por ~5 semanas | [2026-08-c4103-my2026.md](2026-08-c4103-my2026.md) |
