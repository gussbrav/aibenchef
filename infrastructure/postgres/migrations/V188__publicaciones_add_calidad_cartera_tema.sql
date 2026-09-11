-- =========================================================================
-- V188 — admin.publicaciones: agregar calidad_cartera al CHECK de tema
--
-- PROBLEMA: publicaciones_tema_check no incluia 'calidad_cartera', por lo
-- que el INSERT desde /api/v1/publicaciones/generate con tema='calidad_cartera'
-- fallaba con error 23514 "Valor invalido". El tema existe en el codigo
-- (tipo PublicacionTema, prompt calidad-cartera.ts, UI en informe) pero
-- nunca se agrego al constraint de la tabla.
-- =========================================================================

ALTER TABLE admin.publicaciones
    DROP CONSTRAINT IF EXISTS publicaciones_tema_check;

ALTER TABLE admin.publicaciones
    ADD CONSTRAINT publicaciones_tema_check CHECK (
        tema = ANY (ARRAY[
            'benchmarking_sectorial'::text,
            'calidad_cartera'::text,
            'coyuntura_macro'::text,
            'dupont_rentabilidad'::text,
            'evolucion_pe_segmento'::text,
            'mora_visual'::text,
            'rentabilidad_visual'::text
        ])
    );
