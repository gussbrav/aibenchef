// Endpoint de diagnostico del modulo "informe ejecutivo".
// Devuelve estado de las tablas/vistas/funciones criticas para identificar
// rapidamente por que /dashboard/informe falla.
//
// GET /api/v1/informe/diag

import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";
import { handleRoute, requireSession } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

type Check = { name: string; status: "ok" | "missing" | "error"; detail?: string };

async function checkObjectExists(check: { name: string; query: ReturnType<typeof sql>; expectAtLeastOne?: boolean }): Promise<Check> {
  try {
    const rows = await db.execute<{ count: number }>(check.query);
    const count = Number(rows[0]?.count ?? 0);
    if (count === 0 && check.expectAtLeastOne !== false) {
      return { name: check.name, status: "missing", detail: "count=0" };
    }
    return { name: check.name, status: "ok", detail: `count=${count}` };
  } catch (e) {
    const err = e as Error;
    return { name: check.name, status: "error", detail: err.message };
  }
}

export async function GET() {
  return handleRoute(async () => {
    await requireSession();

    const checks: Check[] = await Promise.all([
      checkObjectExists({
        name: "schema_migrations (V033, V034 aplicadas?)",
        query: sql`SELECT COUNT(*)::int AS count FROM public.schema_migrations WHERE version IN ('V033', 'V034')`,
      }),
      checkObjectExists({
        name: "config.cliente (caja-arequipa sembrado?)",
        query: sql`SELECT COUNT(*)::int AS count FROM config.cliente WHERE slug = 'caja-arequipa'`,
      }),
      checkObjectExists({
        name: "config.peer_group (peer de caja-arequipa?)",
        query: sql`SELECT COUNT(*)::int AS count FROM config.peer_group pg JOIN config.cliente c ON c.id = pg.cliente_id WHERE c.slug = 'caja-arequipa'`,
      }),
      checkObjectExists({
        name: "marts.dim_kpi (catalogo de KPIs)",
        query: sql`SELECT COUNT(*)::int AS count FROM marts.dim_kpi`,
      }),
      checkObjectExists({
        name: "marts.fact_kpis_mensuales (tabla existe)",
        query: sql`SELECT COUNT(*)::int AS count FROM marts.fact_kpis_mensuales`,
        expectAtLeastOne: false,
      }),
      checkObjectExists({
        name: "marts.v_punto_equilibrio_ancho (vista existe)",
        query: sql`SELECT COUNT(*)::int AS count FROM marts.v_punto_equilibrio_ancho`,
        expectAtLeastOne: false,
      }),
      checkObjectExists({
        name: "marts.v_eeff_balance_ancho (wrapper V026)",
        query: sql`SELECT COUNT(*)::int AS count FROM marts.v_eeff_balance_ancho LIMIT 1`,
      }),
      checkObjectExists({
        name: "marts.mv_eeff_resultados_ancho",
        query: sql`SELECT COUNT(*)::int AS count FROM marts.mv_eeff_resultados_ancho LIMIT 1`,
      }),
      checkObjectExists({
        name: "dw.dim_entidad (con columna nomb_correg)",
        query: sql`SELECT COUNT(*)::int AS count FROM dw.dim_entidad WHERE NOT es_total AND NOT es_sucursal AND activa`,
      }),
      checkObjectExists({
        name: "raw.eeff_observacion (ultima carga)",
        query: sql`SELECT COUNT(DISTINCT periodo)::int AS count FROM raw.eeff_observacion`,
      }),
    ]);

    // Info adicional util
    let ultimoPeriodoER: number | null = null;
    let ultimoPeriodoBG: number | null = null;
    let migracionesAplicadas: string[] = [];

    try {
      const r1 = await db.execute<{ maxp: number }>(sql`SELECT MAX(periodo)::int AS maxp FROM marts.mv_eeff_resultados_ancho`);
      ultimoPeriodoER = Number(r1[0]?.maxp ?? 0) || null;
    } catch {}

    try {
      const r2 = await db.execute<{ maxp: number }>(sql`SELECT MAX(periodo)::int AS maxp FROM marts.v_eeff_balance_ancho`);
      ultimoPeriodoBG = Number(r2[0]?.maxp ?? 0) || null;
    } catch {}

    try {
      const r3 = await db.execute<{ version: string }>(sql`SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 10`);
      migracionesAplicadas = r3.map((r) => String(r.version));
    } catch {}

    // Lista de los primeros 30 nomb_correg en dim_entidad — para entender
    // el formato real que tienen vs lo que asume el peer group seed.
    let entidadesEjemplo: string[] = [];
    try {
      const r4 = await db.execute<{ nomb_correg: string }>(sql`
        SELECT DISTINCT nomb_correg
        FROM dw.dim_entidad
        WHERE NOT es_total AND NOT es_sucursal AND activa
        ORDER BY nomb_correg
        LIMIT 30
      `);
      entidadesEjemplo = r4.map((r) => String(r.nomb_correg));
    } catch {}

    // Que dice el peer group de caja-arequipa hoy
    let peerGroupSembrado: string[] = [];
    try {
      const r5 = await db.execute<{ competidor_nomb_correg: string }>(sql`
        SELECT pg.competidor_nomb_correg
        FROM config.peer_group pg
        JOIN config.cliente c ON c.id = pg.cliente_id
        WHERE c.slug = 'caja-arequipa'
        ORDER BY pg.orden
      `);
      peerGroupSembrado = r5.map((r) => String(r.competidor_nomb_correg));
    } catch {}

    return {
      checks,
      ultimoPeriodoER,
      ultimoPeriodoBG,
      migracionesAplicadas,
      entidadesEjemplo,
      peerGroupSembrado,
      ts: new Date().toISOString(),
    };
  });
}
