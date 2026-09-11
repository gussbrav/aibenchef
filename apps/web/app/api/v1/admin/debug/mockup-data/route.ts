import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/infrastructure/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const results: Record<string, unknown> = {};

  try {
    const r1 = await db.execute<{ periodo: number }>(sql`
      SELECT MAX(periodo)::int AS periodo FROM marts.v_eeff_balance_ancho
    `);
    results["max_periodo_balance"] = r1[0] ?? null;
  } catch (e) {
    results["max_periodo_balance_error"] = String(e);
  }

  try {
    const r2 = await db.execute<{ periodo: number }>(sql`
      SELECT MAX(periodo)::int AS periodo FROM marts.mv_eeff_balance_ancho
    `);
    results["max_periodo_mv_balance"] = r2[0] ?? null;
  } catch (e) {
    results["max_periodo_mv_balance_error"] = String(e);
  }

  try {
    const r3 = await db.execute<{ periodo: number }>(sql`
      SELECT MAX(periodo)::int AS periodo FROM marts.mv_mora_global_historica
    `);
    results["max_periodo_mora"] = r3[0] ?? null;
  } catch (e) {
    results["max_periodo_mora_error"] = String(e);
  }

  try {
    const r4 = await db.execute<{ periodo: number }>(sql`
      SELECT MAX(periodo)::int AS periodo FROM marts.mv_cobertura_car_historica
    `);
    results["max_periodo_cobertura"] = r4[0] ?? null;
  } catch (e) {
    results["max_periodo_cobertura_error"] = String(e);
  }

  try {
    const r5 = await db.execute<{ nomb_correg: string }>(sql`
      SELECT b.nomb_correg
        FROM marts.v_eeff_balance_ancho b
       WHERE b.periodo = (SELECT MAX(periodo) FROM marts.v_eeff_balance_ancho)
         AND b.moneda = 'TOTAL' AND b.tipo_entidad = 'BANCOS'
         AND EXISTS (
           SELECT 1 FROM marts.v_mora_global_historica m
            WHERE m.periodo = b.periodo AND m.nomb_correg = b.nomb_correg
         )
       ORDER BY COALESCE(b.cta_a4_1,0)+COALESCE(b.cta_a4_2,0)+COALESCE(b.cta_a4_3,0) DESC
       LIMIT 5
    `);
    results["top5_bancos_con_mora"] = r5.map((r) => r.nomb_correg);
  } catch (e) {
    results["top5_bancos_error"] = String(e);
  }

  try {
    const r6 = await db.execute<{ nomb_correg: string; mora: string }>(sql`
      SELECT nomb_correg, pct_mora_global::text AS mora
        FROM marts.v_mora_global_historica
       WHERE periodo = (SELECT MAX(periodo) FROM marts.v_eeff_balance_ancho)
       LIMIT 10
    `);
    results["muestra_mora"] = r6.map((r) => ({ e: r.nomb_correg, mora: r.mora }));
  } catch (e) {
    results["muestra_mora_error"] = String(e);
  }

  // Verificar si v_eeff_resultados_ancho existe (o solo la MV)
  try {
    const r7 = await db.execute<{ periodo: number }>(sql`
      SELECT MAX(periodo)::int AS periodo FROM marts.v_eeff_resultados_ancho
    `);
    results["max_periodo_resultados_view"] = r7[0] ?? null;
  } catch (e) {
    results["v_eeff_resultados_ancho_error"] = String(e);
  }

  try {
    const r8 = await db.execute<{ periodo: number }>(sql`
      SELECT MAX(periodo)::int AS periodo FROM marts.mv_eeff_resultados_ancho
    `);
    results["max_periodo_resultados_mv"] = r8[0] ?? null;
  } catch (e) {
    results["mv_eeff_resultados_ancho_error"] = String(e);
  }

  return NextResponse.json(results, { status: 200 });
}
