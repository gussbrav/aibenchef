import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const results: Record<string, unknown> = {};

  // Paso 1: MAX periodo
  let periodo: number | null = null;
  try {
    const r = await db.execute<{ periodo: number }>(sql`
      SELECT MAX(periodo)::int AS periodo FROM marts.v_eeff_balance_ancho
    `);
    periodo = r[0]?.periodo ?? null;
    results["paso1_periodo"] = periodo;
  } catch (e) {
    results["paso1_error"] = String(e);
    return NextResponse.json(results);
  }

  if (!periodo) {
    results["paso1_vacio"] = true;
    return NextResponse.json(results);
  }

  // Paso 2: Top 5 bancos con filtros NOT LIKE
  let entidades: string[] = [];
  try {
    const r = await db.execute<{ nomb_correg: string }>(sql`
      SELECT b.nomb_correg
        FROM marts.v_eeff_balance_ancho b
       WHERE b.periodo      = ${periodo}
         AND b.moneda       = 'TOTAL'
         AND b.tipo_entidad = 'BANCOS'
         AND b.nomb_correg  NOT LIKE 'Total%'
         AND b.nomb_correg  NOT LIKE '%con Sucursales en el Exterior%'
         AND b.nomb_correg  NOT LIKE '%Incluye Sucursales%'
       ORDER BY COALESCE(b.cta_a4_1, 0) + COALESCE(b.cta_a4_2, 0) + COALESCE(b.cta_a4_3, 0) DESC
       LIMIT 5
    `);
    entidades = r.map((row) => row.nomb_correg);
    results["paso2_entidades"] = entidades;
  } catch (e) {
    results["paso2_error"] = String(e);
    return NextResponse.json(results);
  }

  // Paso 3: verificar v_eeff_resultados_ancho vs mv_
  try {
    const r = await db.execute<{ periodo: number }>(sql`
      SELECT MAX(periodo)::int AS periodo FROM marts.v_eeff_resultados_ancho
    `);
    results["paso3_v_resultados_ok"] = r[0]?.periodo ?? null;
  } catch (e) {
    results["paso3_v_resultados_error"] = String(e);
  }

  try {
    const r = await db.execute<{ periodo: number }>(sql`
      SELECT MAX(periodo)::int AS periodo FROM marts.mv_eeff_resultados_ancho
    `);
    results["paso3_mv_resultados_ok"] = r[0]?.periodo ?? null;
  } catch (e) {
    results["paso3_mv_resultados_error"] = String(e);
  }

  // Paso 4: KPI query con entidades reales
  if (entidades.length > 0) {
    const periodoAnterior = (Math.floor(periodo / 100) - 1) * 100 + (periodo % 100);
    const mes = periodo % 100;
    const mesDesde = mes - 11;
    const periodoTtmDesde = mesDesde > 0
      ? Math.floor(periodo / 100) * 100 + mesDesde
      : (Math.floor(periodo / 100) - 1) * 100 + (mesDesde + 12);

    results["paso4_params"] = { periodo, periodoAnterior, periodoTtmDesde };

    try {
      const r = await db.execute<{ nomb_correg: string; cartera: string | null }>(sql`
        SELECT nomb_correg, (COALESCE(cta_a4_1,0)+COALESCE(cta_a4_2,0)+COALESCE(cta_a4_3,0))::text AS cartera
          FROM marts.v_eeff_balance_ancho
         WHERE periodo = ${periodo}
           AND moneda  = 'TOTAL'
           AND nomb_correg = ANY(${entidades}::text[])
      `);
      results["paso4_balance_ok"] = r.map((x) => ({ e: x.nomb_correg, c: x.cartera }));
    } catch (e) {
      results["paso4_balance_error"] = String(e);
    }

    try {
      const r = await db.execute<{ nomb_correg: string; utilidad: string | null }>(sql`
        SELECT nomb_correg, SUM(cta_17)::text AS utilidad
          FROM marts.mv_eeff_resultados_ancho
         WHERE periodo BETWEEN ${periodoTtmDesde} AND ${periodo}
           AND moneda  = 'TOTAL'
           AND nomb_correg = ANY(${entidades}::text[])
         GROUP BY nomb_correg
      `);
      results["paso4_resultados_ok"] = r.map((x) => ({ e: x.nomb_correg, u: x.utilidad }));
    } catch (e) {
      results["paso4_resultados_error"] = String(e);
    }

    try {
      const r = await db.execute<{ nomb_correg: string; mora: string | null }>(sql`
        SELECT nomb_correg, pct_mora_global::text AS mora
          FROM marts.v_mora_global_historica
         WHERE periodo = ${periodo}
           AND nomb_correg = ANY(${entidades}::text[])
      `);
      results["paso4_mora_ok"] = r.map((x) => ({ e: x.nomb_correg, m: x.mora }));
    } catch (e) {
      results["paso4_mora_error"] = String(e);
    }
  }

  return NextResponse.json(results, { status: 200 });
}
