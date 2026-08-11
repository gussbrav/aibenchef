-- =========================================================================
-- V165 — Agregar 'mora_visual' y 'rentabilidad_visual' al CHECK de tema
-- =========================================================================
--
-- Bug reportado 2026-08-11: al generar articulo con tema=mora_visual el
-- INSERT fallaba con "Valor invalido" porque el CHECK constraint
-- publicaciones_tema_check solo permite los 4 temas originales.
--
-- Es el mismo tipo de enum drift TS<->DB que ya paso con V155 (agregar
-- 'punto_equilibrio' a insights). Convencion: cada vez que se agrega un
-- tema al TS enum PUBLICACION_TEMAS, tambien hay que actualizar este
-- CHECK con una migration Vxxx.
--
-- Idempotente: DROP + ADD con nombre estable.
-- =========================================================================

ALTER TABLE admin.publicaciones
    DROP CONSTRAINT IF EXISTS publicaciones_tema_check;

ALTER TABLE admin.publicaciones
    ADD CONSTRAINT publicaciones_tema_check
    CHECK (tema = ANY (ARRAY[
        'benchmarking_sectorial'::text,
        'coyuntura_macro'::text,
        'dupont_rentabilidad'::text,
        'evolucion_pe_segmento'::text,
        'mora_visual'::text,
        'rentabilidad_visual'::text
    ]));
