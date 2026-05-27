-- V088 — Vista wrapper marts.v_eeff_balance_ancho sobre la MV
--
-- Patron "stable view layer": el frontend consulta `marts.v_*` (vistas
-- normales) y nosotros internamente decidimos si la implementacion es
-- una MV (materializada para perf) o una view recalculada. Permite
-- cambiar entre ambas sin breaking changes en el frontend.
--
-- Esta migration crea el wrapper que el codigo del panel informe
-- esperaba (referencia: app/api/v1/informe/diag/route.ts -> "wrapper V026").
--
-- Resuelve issue #6 (sintoma: panel informe muestra "6 de 6 entidades
-- sin data" porque consulta una vista que no existe).

CREATE OR REPLACE VIEW marts.v_eeff_balance_ancho AS
    SELECT * FROM marts.mv_eeff_balance_ancho;

COMMENT ON VIEW marts.v_eeff_balance_ancho IS
    'Stable view wrapper sobre marts.mv_eeff_balance_ancho. El frontend (panel '
    'informe) consulta este wrapper para no acoplarse a la implementacion '
    'fisica (MV vs view). Cambios en la MV subyacente deben preservar las '
    'columnas expuestas aqui. Ver issue #6 para historia.';
