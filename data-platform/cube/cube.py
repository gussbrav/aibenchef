"""Cube.dev config — security context multi-tenant.

Lee entitlements de Postgres para filtrar entidades/historico segun plan.
"""

from cube import config


@config("query_rewrite")
def query_rewrite(query, ctx):  # type: ignore[no-untyped-def]
    """Aplica filtros automaticos segun entitlements del tenant."""
    security = ctx["securityContext"]
    if security.get("super_admin"):
        return query

    grupos = security.get("grupos_acceso", ["cmac"])
    query.setdefault("filters", []).append(
        {
            "dimension": "Entidad.grupo",
            "operator": "in",
            "values": grupos,
        }
    )

    return query
