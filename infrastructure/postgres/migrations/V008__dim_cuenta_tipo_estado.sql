-- =========================================================================
-- V008: Actualizar el CHECK constraint de dw.dim_cuenta.tipo_estado
--
-- V003 lo definio con valores ('BG','ER','NOTAS','COLOCACIONES',...). Decidimos
-- migrar al naming del dominio (balance, resultados, indicador) que es lo que
-- usa la entity Cuenta del Python data-platform. Mas legible y consistente
-- con el resto del codigo.
-- =========================================================================

ALTER TABLE dw.dim_cuenta
    DROP CONSTRAINT IF EXISTS dim_cuenta_tipo_estado_check;

ALTER TABLE dw.dim_cuenta
    ADD CONSTRAINT dim_cuenta_tipo_estado_check
    CHECK (tipo_estado IN (
        'balance',
        'resultados',
        'indicador',
        'colocaciones',
        'depositos',
        'castigos',
        'clientes',
        'oficinas',
        'personal'
    ));
