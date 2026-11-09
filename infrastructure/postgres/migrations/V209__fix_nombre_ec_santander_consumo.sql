-- =========================================================================
-- V209: Corregir mapeo duplicado de "EC Santander Consumo" en dw.entidad_nombre
--
-- Bug: "EC Santander Consumo" (nombre SBS en raw.castigos_observacion)
-- estaba registrado tanto en entidad 32 (Santander Consumer Bank / BANCOS)
-- como en entidad 57 (Santander Consumo / EDPYMES).
--
-- dw.raw_to_vigente() resuelve por entidad_id mas bajo (32) y retorna
-- "Santander Consumer Bank" en lugar de "Santander Consumo". Consecuencia:
-- v_castigos_12m_historica.castigos_12m = COALESCE(NULL, 0) = 0 para
-- "Santander Consumo" — dato faltante mostrado erroneamente como cero.
--
-- Fix: eliminar "EC Santander Consumo" de entidad 32 (Banco). La sigla
-- "EC" = Empresa de Creditos, que corresponde exclusivamente al EDPYME
-- (entidad 57, Santander Consumo). Santander Consumer Bank (Banco) tiene
-- su propio set de nombres sin ambiguedad.
-- =========================================================================

DELETE FROM dw.entidad_nombre
WHERE entidad_id = 32
  AND nombre = 'EC Santander Consumo';
