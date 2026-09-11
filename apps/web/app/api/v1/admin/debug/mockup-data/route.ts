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
      SELECT nomb_correg
        FROM marts.v_eeff_balance_ancho
       WHERE periodo = (SELECT MAX(periodo) FROM marts.v_eeff_balance_ancho)
         AND moneda = 'TOTAL' AND tipo_entidad = 'BANCOS'
       ORDER BY COALESCE(cta_a4_1,0)+COALESCE(cta_a4_2,0)+COALESCE(cta_a4_3,0) DESC
       LIMIT 5
    `);
    results["top5_bancos"] = r5.map((r) => r.nomb_correg);
  } catch (e) {
    results["top5_bancos_error"] = String(e);
  }

  return NextResponse.json(results, { status: 200 });
}
