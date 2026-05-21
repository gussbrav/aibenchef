{{ config(materialized='view') }}

-- Staging: limpia y tipa raw.sbs_eeff
-- Se completa cuando el parser este listo y popule raw.sbs_eeff
select
    periodo_yyyymm        as periodo_id,
    entidad_codigo_sbs    as codigo_sbs,
    cuenta_codigo         as codigo_cuenta,
    moneda                as codigo_moneda,
    cast(valor as numeric(20, 2)) as valor,
    loaded_at,
    loaded_by_run_id
from {{ source('raw_sbs', 'eeff') }}
where valor is not null
