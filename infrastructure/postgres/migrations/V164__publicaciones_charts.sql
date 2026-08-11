-- =========================================================================
-- V164 — Charts embebidos en admin.publicaciones (2026-08-11)
-- =========================================================================
--
-- Contexto: los articulos de /publicaciones se estaban generando como
-- solo-texto (markdown). Feature request (Juan Jose 2026-08-10):
-- articulos data-driven clase mundial estilo NYT / Washington Post con
-- graficos SVG embebidos.
--
-- Decision: guardar los SVGs directo en la row de admin.publicaciones
-- como columna JSONB. Un articulo tiene 0-3 charts. Cada chart es
-- {id, tipo, titulo, subtitulo, svg, altText}. En el markdown se usan
-- placeholders `[[CHART:chart-1]]` que la UI reemplaza al renderizar.
--
-- Trade-off vs tabla separada admin.publicacion_charts:
--   - Los charts son pequeños (<20KB c/u), N=0..3 por publicacion.
--   - Se cargan/persisten atomicamente con la publicacion (una sola row).
--   - No hay caso de uso de "chart standalone" (chart siempre pertenece a
--     un articulo — cero riesgo de N+1 futuro).
-- Por eso: columna JSONB en la misma tabla, no tabla separada.
-- =========================================================================

ALTER TABLE admin.publicaciones
    ADD COLUMN IF NOT EXISTS charts JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN admin.publicaciones.charts IS
    'Array de charts SVG embebidos en el articulo. Shape: '
    '[{id: "chart-1", tipo: "line"|"bar", titulo, subtitulo, svg, altText}]. '
    'Los placeholders [[CHART:chart-1]] en contenido_md se reemplazan por '
    'el SVG correspondiente al renderizar la UI. Ver '
    'apps/web/lib/domains/publicaciones/charts/ para el engine.';

-- Los articulos viejos quedan con charts=[] (default). Backward compatible.
