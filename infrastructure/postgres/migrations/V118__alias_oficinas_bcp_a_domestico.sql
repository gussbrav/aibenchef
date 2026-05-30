-- =========================================================================
-- V118: reasignar aliases "oficinas-style" de BCP del consolidado al
--       domestico, para que el Informe muestre datos completos.
--
-- PROBLEMA:
--   SBS publica raw.oficinas_observacion con `empresa =
--   "B. de Crédito del Perú (con sucursales en el exterior)"`. Ese nombre
--   tenia alias hacia entidad 95 (BCP con Sucursales). Pero el Informe
--   busca BCP por su nombre comercial "Banco de Crédito del Perú" (entidad
--   47, domestico) — resultado: N de agencias = "—".
--
--   Lo mismo aplica a otros bancos cuyos datos de oficinas se publican bajo
--   nombres abreviados o con sufijo "(con sucursales)" diferentes a sus
--   nombres EEFF.
--
-- FIX:
--   Mover los aliases problematicos al entidad_id del nombre canonico que
--   el Informe usa. Esto NO afecta EEFF porque raw.eeff_observacion ya usa
--   "Banco de Crédito del Perú" exactamente (alias domestico canonical).
--   Solo afecta oficinas/clientes/depositos/etc. donde el SBS abrevia.
--
-- IDEMPOTENTE: ON CONFLICT DO NOTHING en el INSERT + UPDATE explicito
-- solo si el alias actual va a la entidad equivocada.
-- =========================================================================

-- 1. Mover alias de oficinas-BCP al BCP domestico (entidad 47)
UPDATE dw.entidad_nombre
SET entidad_id = 47
WHERE nombre = 'B. de Crédito del Perú (con sucursales en el exterior)'
  AND entidad_id = 95;

-- 1b. Aliases genericos ambiguos: estaban duplicados entre entidad 47 y 95.
-- Cuando hay duplicado, el LIMIT 1 del resolver_nomb_correg_canonico es
-- no deterministico → a veces resuelve al consolidado en lugar del
-- domestico, dejando vacios en el Informe.
-- Fix: eliminar de entidad 95 los aliases genericos (Banco de Crédito sin
-- "con Sucursales"), preservando los especificos del consolidado.
DELETE FROM dw.entidad_nombre
WHERE entidad_id = 95
  AND tipo = 'alias'
  AND nombre IN ('Banco de Crédito', 'Banco de Credito', 'CREDITO',
                 'Banco de Crédito del Perú');

-- 2. Crear aliases adicionales para variantes abreviadas BCP en archivos
--    raw (oficinas, creditos_depositos_oficina, etc).
INSERT INTO dw.entidad_nombre (entidad_id, nombre, tipo, consolidar, fuente)
SELECT em.id, alias_nombre, 'alias', true, 'V118 — variantes archivos SBS'
FROM dw.entidad_maestra em
JOIN (VALUES
    (47, 'B. de Crédito del Perú'),
    (47, 'BANCO DE CREDITO'),
    (47, 'Banco de Crédito'),
    (47, 'Banco de Credito')
) AS new_aliases(eid, alias_nombre) ON em.id = new_aliases.eid
ON CONFLICT DO NOTHING;

-- Nota: marts.v_oficinas_por_entidad_canonico es VIEW (no materializada),
-- entonces no requiere REFRESH — el query del Informe usa el mapping
-- actualizado en cada lectura.
