"""Integration test para auto-resolve de stale checks (issue #43).

Verifica que la logica del UPDATE en `pipeline quality-check` clasifica
correctamente las anomalias previas de un periodo cuando se re-corre el
chequeo:

  - auto_resolved   : la anomalia previa ya no aparece en el run actual.
  - auto_superseded : la anomalia previa sigue existiendo en el run actual.

Se prueba la SQL directamente (no via CLI completo) porque montar las
vistas marts.v_dq_* + raw.eeff_observacion + dw.cabecera_maestra agrega
costo sin probar nada nuevo: la SQL es lo que importa.
"""

from __future__ import annotations

from collections.abc import Iterator

import psycopg
import pytest

pytestmark = [pytest.mark.integration]


AUTO_RESOLVE_SQL = """
    UPDATE admin.data_quality_checks AS prev
       SET reviewed_at   = now(),
           reviewed_by   = 'system:quality-check',
           review_action = CASE WHEN EXISTS (
               SELECT 1
                 FROM admin.data_quality_checks AS run
                WHERE run.carga_log_id = %(log_id)s
                  AND run.periodo      = prev.periodo
                  AND run.nomb_correg  = prev.nomb_correg
                  AND run.check_type   = prev.check_type
                  AND COALESCE(run.cuenta_codigo, '') =
                      COALESCE(prev.cuenta_codigo, '')
           ) THEN 'auto_superseded'
             ELSE 'auto_resolved'
           END,
           review_notes  = %(notes)s
     WHERE prev.periodo       = %(periodo)s
       AND prev.reviewed_at  IS NULL
       AND prev.carga_log_id IS DISTINCT FROM %(log_id)s
     RETURNING id, review_action
"""


@pytest.fixture
def schema(pg_dsn: str) -> Iterator[str]:
    """Crea schema minimo (admin.data_quality_checks + raw.carga_log)."""
    with psycopg.connect(pg_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE SCHEMA IF NOT EXISTS admin;")
            cur.execute("CREATE SCHEMA IF NOT EXISTS raw;")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS raw.carga_log (
                    id BIGSERIAL PRIMARY KEY,
                    source TEXT NOT NULL DEFAULT 'test',
                    started_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS admin.data_quality_checks (
                    id              BIGSERIAL PRIMARY KEY,
                    periodo         INT NOT NULL,
                    nomb_correg     TEXT NOT NULL,
                    check_type      TEXT NOT NULL
                                    CHECK (check_type IN (
                                        'balance_contable',
                                        'outlier_zscore',
                                        'suma_subcuentas'
                                    )),
                    cuenta_codigo   TEXT,
                    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
                    carga_log_id    BIGINT REFERENCES raw.carga_log(id) ON DELETE SET NULL,
                    status          TEXT NOT NULL
                                    CHECK (status IN ('ok','warning','critical')),
                    expected_value  NUMERIC,
                    actual_value    NUMERIC,
                    delta_abs       NUMERIC,
                    delta_pct       NUMERIC,
                    z_score         NUMERIC,
                    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
                    reviewed_at     TIMESTAMPTZ,
                    reviewed_by     TEXT,
                    review_action   TEXT,
                    review_notes    TEXT
                );
            """)
            cur.execute("TRUNCATE admin.data_quality_checks RESTART IDENTITY CASCADE;")
            cur.execute("TRUNCATE raw.carga_log RESTART IDENTITY CASCADE;")
        conn.commit()
    yield pg_dsn


def _insert_check(
    cur,
    *,
    periodo: int,
    nomb_correg: str,
    check_type: str,
    cuenta_codigo: str | None,
    status: str,
    carga_log_id: int,
) -> int:
    cur.execute(
        """
        INSERT INTO admin.data_quality_checks
            (periodo, nomb_correg, check_type, cuenta_codigo, carga_log_id, status)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (periodo, nomb_correg, check_type, cuenta_codigo, carga_log_id, status),
    )
    return cur.fetchone()[0]


def _new_log(cur) -> int:
    cur.execute("INSERT INTO raw.carga_log DEFAULT VALUES RETURNING id;")
    return cur.fetchone()[0]


def test_anomalia_que_desaparece_se_marca_auto_resolved(schema: str) -> None:
    """El caso BCP A3: una anomalia previa que el re-ingest corrigio."""
    with psycopg.connect(schema) as conn, conn.cursor() as cur:
        log_old = _new_log(cur)
        log_new = _new_log(cur)

        old_id = _insert_check(
            cur,
            periodo=202603,
            nomb_correg="Banco de Crédito del Perú",
            check_type="suma_subcuentas",
            cuenta_codigo="A3",
            status="critical",
            carga_log_id=log_old,
        )

        cur.execute(
            AUTO_RESOLVE_SQL,
            {
                "log_id": log_new,
                "notes": f"Run carga_log_id={log_new} refresco el periodo.",
                "periodo": 202603,
            },
        )
        rows = cur.fetchall()

        assert len(rows) == 1
        row_id, action = rows[0]
        assert row_id == old_id
        assert action == "auto_resolved"

        cur.execute(
            "SELECT reviewed_at, reviewed_by, review_action, review_notes "
            "FROM admin.data_quality_checks WHERE id = %s",
            (old_id,),
        )
        reviewed_at, reviewed_by, review_action, review_notes = cur.fetchone()
        assert reviewed_at is not None
        assert reviewed_by == "system:quality-check"
        assert review_action == "auto_resolved"
        assert str(log_new) in review_notes


def test_anomalia_persistente_se_marca_auto_superseded(schema: str) -> None:
    """Misma key (entidad+cuenta+check_type) en run viejo y nuevo → superseded."""
    with psycopg.connect(schema) as conn, conn.cursor() as cur:
        log_old = _new_log(cur)
        log_new = _new_log(cur)

        old_id = _insert_check(
            cur,
            periodo=202603,
            nomb_correg="CMAC Arequipa",
            check_type="outlier_zscore",
            cuenta_codigo="A1",
            status="critical",
            carga_log_id=log_old,
        )
        new_id = _insert_check(
            cur,
            periodo=202603,
            nomb_correg="CMAC Arequipa",
            check_type="outlier_zscore",
            cuenta_codigo="A1",
            status="warning",
            carga_log_id=log_new,
        )

        cur.execute(
            AUTO_RESOLVE_SQL,
            {
                "log_id": log_new,
                "notes": f"Run {log_new}.",
                "periodo": 202603,
            },
        )
        rows = dict(cur.fetchall())

        assert old_id in rows
        assert rows[old_id] == "auto_superseded"
        assert new_id not in rows  # el del run actual NO se toca


def test_no_toca_otro_periodo(schema: str) -> None:
    """Las anomalias de otros periodos no deben ser afectadas."""
    with psycopg.connect(schema) as conn, conn.cursor() as cur:
        log_old = _new_log(cur)
        log_new = _new_log(cur)

        other = _insert_check(
            cur,
            periodo=202602,  # NO el periodo del run actual
            nomb_correg="Banco de Crédito del Perú",
            check_type="balance_contable",
            cuenta_codigo=None,
            status="critical",
            carga_log_id=log_old,
        )

        cur.execute(
            AUTO_RESOLVE_SQL,
            {
                "log_id": log_new,
                "notes": f"Run {log_new}.",
                "periodo": 202603,  # otro periodo
            },
        )
        assert cur.fetchall() == []

        cur.execute(
            "SELECT reviewed_at FROM admin.data_quality_checks WHERE id = %s",
            (other,),
        )
        assert cur.fetchone()[0] is None  # sigue unreviewed


def test_no_toca_anomalias_ya_revisadas_manualmente(schema: str) -> None:
    """Si el operador ya reviso una anomalia (reviewed_at IS NOT NULL),
    NO la sobreescribimos con auto-resolve.
    """
    with psycopg.connect(schema) as conn, conn.cursor() as cur:
        log_old = _new_log(cur)
        log_new = _new_log(cur)

        manual = _insert_check(
            cur,
            periodo=202603,
            nomb_correg="Banco de Crédito del Perú",
            check_type="suma_subcuentas",
            cuenta_codigo="A3",
            status="critical",
            carga_log_id=log_old,
        )
        cur.execute(
            "UPDATE admin.data_quality_checks "
            "SET reviewed_at=now(), reviewed_by='gus@az', "
            "    review_action='accepted', review_notes='caso revisado' "
            "WHERE id=%s",
            (manual,),
        )

        cur.execute(
            AUTO_RESOLVE_SQL,
            {
                "log_id": log_new,
                "notes": f"Run {log_new}.",
                "periodo": 202603,
            },
        )
        assert cur.fetchall() == []  # no toca nada

        cur.execute(
            "SELECT reviewed_by, review_action FROM admin.data_quality_checks WHERE id = %s",
            (manual,),
        )
        reviewed_by, review_action = cur.fetchone()
        assert reviewed_by == "gus@az"  # preservado
        assert review_action == "accepted"


def test_misma_corrida_no_se_auto_resuelve_a_si_misma(schema: str) -> None:
    """Las anomalias del carga_log_id actual NO deben quedar marcadas
    como auto_resolved (es la corrida que las acaba de insertar).
    """
    with psycopg.connect(schema) as conn, conn.cursor() as cur:
        log_new = _new_log(cur)
        fresh = _insert_check(
            cur,
            periodo=202603,
            nomb_correg="BCP",
            check_type="balance_contable",
            cuenta_codigo=None,
            status="critical",
            carga_log_id=log_new,
        )

        cur.execute(
            AUTO_RESOLVE_SQL,
            {
                "log_id": log_new,
                "notes": f"Run {log_new}.",
                "periodo": 202603,
            },
        )
        assert cur.fetchall() == []

        cur.execute(
            "SELECT reviewed_at FROM admin.data_quality_checks WHERE id = %s",
            (fresh,),
        )
        assert cur.fetchone()[0] is None


def test_cuenta_codigo_null_se_compara_consistentemente(schema: str) -> None:
    """balance_contable usa cuenta_codigo=NULL. La comparacion por COALESCE
    debe tratar NULL == NULL como igual (para superseded), no como distintos.
    """
    with psycopg.connect(schema) as conn, conn.cursor() as cur:
        log_old = _new_log(cur)
        log_new = _new_log(cur)

        old_id = _insert_check(
            cur,
            periodo=202603,
            nomb_correg="BCP",
            check_type="balance_contable",
            cuenta_codigo=None,
            status="critical",
            carga_log_id=log_old,
        )
        _insert_check(
            cur,
            periodo=202603,
            nomb_correg="BCP",
            check_type="balance_contable",
            cuenta_codigo=None,  # tambien NULL
            status="warning",
            carga_log_id=log_new,
        )

        cur.execute(
            AUTO_RESOLVE_SQL,
            {
                "log_id": log_new,
                "notes": f"Run {log_new}.",
                "periodo": 202603,
            },
        )
        rows = dict(cur.fetchall())

        assert rows[old_id] == "auto_superseded"
