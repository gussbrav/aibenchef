-- V151 — Merge Compartamos Financiera (historico) -> Banco Compartamos (actual)
--
-- Usuario reporta: al elegir "Compartamos Financiera" no aparecen datos a
-- Jun 2026. Al elegir "Banco Compartamos" si. Son la MISMA entidad —
-- Compartamos evoluciono de Financiera a Banco (compraventa de Banco
-- Sudamericano en 2023). Un cliente nuevo que solo conoce "Banco
-- Compartamos" no sabe que la historia completa vive bajo "Financiera
-- Compartamos" pre-2023.
--
-- Usamos el helper reusable dw.merge_entidad_maestra() de V149. Es
-- idempotente: si no encuentra el canonico devuelve 'skip' sin fallar.
-- Intentamos varias combinaciones probables de nombres canonicos (los
-- reales pueden ser "Compartamos Financiera", "Financiera Compartamos",
-- "Compartamos" pelado, "Banco Compartamos", etc.) — solo el par que
-- exista en la maestra ejecuta el merge, el resto son no-op.
--
-- Fecha de rename: 2023-01-01 (aproximada — Compartamos se convirtio a
-- banco en 2023). Idempotente.

-- =========================================================================
-- Intentos de merge — el helper devuelve 'skip: canonico X no existe...'
-- para las combinaciones que no aplican. Al menos uno debe hacer el merge
-- real.
-- =========================================================================

-- Combinacion 1: canonico historico "Financiera Compartamos"
SELECT * FROM dw.merge_entidad_maestra(
    _canonico_actual := 'Banco Compartamos',
    _canonico_historico := 'Financiera Compartamos',
    _fecha_rename := '2023-01-01'::date
);

-- Combinacion 2: canonico historico "Compartamos Financiera"
SELECT * FROM dw.merge_entidad_maestra(
    _canonico_actual := 'Banco Compartamos',
    _canonico_historico := 'Compartamos Financiera',
    _fecha_rename := '2023-01-01'::date
);

-- Combinacion 3: canonico actual con 'Compartamos Banco'
SELECT * FROM dw.merge_entidad_maestra(
    _canonico_actual := 'Compartamos Banco',
    _canonico_historico := 'Financiera Compartamos',
    _fecha_rename := '2023-01-01'::date
);

-- Combinacion 4: variantes con 'Compartamos' pelado
SELECT * FROM dw.merge_entidad_maestra(
    _canonico_actual := 'Compartamos Banco',
    _canonico_historico := 'Compartamos Financiera',
    _fecha_rename := '2023-01-01'::date
);

-- Post-merge: cuando el usuario navegue en el dashboard con consolidar=true
-- (default), los aliases historicos de Compartamos Financiera resolverian
-- al canonico actual (Banco Compartamos) via dw.resolver_nomb_correg_canonico.
-- Ver historia completa desde 200801 (o cuando exista data mas antigua).
