/**
 * Health endpoint detallado.
 *
 * GET /api/health        -> respuesta minima (200 si vivo, 503 si DB caido)
 * GET /api/health?deep=1 -> respuesta extendida con estado de cada subsistema
 *
 * Sin deep el endpoint es barato (<5ms) y sirve para load balancers.
 * Con deep es mas caro (~200ms) y sirve para monitoring/observability.
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/infrastructure/db";

export const dynamic = "force-dynamic";

const STARTED_AT = new Date().toISOString();

type Check = {
  name: string;
  status: "ok" | "degraded" | "error";
  detail?: string;
  durationMs?: number;
};

async function checkDb(): Promise<Check> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { name: "db", status: "ok", durationMs: Date.now() - start };
  } catch (e) {
    return {
      name: "db",
      status: "error",
      detail: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

async function checkMvFreshness(): Promise<Check> {
  const start = Date.now();
  try {
    const rows = await db.execute<{ max_periodo: number; n_filas: number }>(
      sql`SELECT MAX(periodo)::int AS max_periodo, COUNT(*)::int AS n_filas FROM marts.mv_eeff_ratios`,
    );
    const maxPeriodo = Number(rows[0]?.max_periodo ?? 0);
    const nFilas = Number(rows[0]?.n_filas ?? 0);

    // Comparamos contra mes actual: si data > 3 meses atras, degraded
    const now = new Date();
    const yyyymmNow = now.getFullYear() * 100 + (now.getMonth() + 1);
    const lagMeses = Math.max(
      0,
      (Math.floor(yyyymmNow / 100) - Math.floor(maxPeriodo / 100)) * 12 +
        ((yyyymmNow % 100) - (maxPeriodo % 100)),
    );

    return {
      name: "marts_mv_eeff_ratios",
      status: lagMeses > 3 ? "degraded" : "ok",
      detail: `max_periodo=${maxPeriodo}, filas=${nFilas}, lag=${lagMeses} meses`,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      name: "marts_mv_eeff_ratios",
      status: "error",
      detail: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

async function checkAiProviders(): Promise<Check> {
  const start = Date.now();
  try {
    const rows = await db.execute<{ provider: string; enabled: boolean; configured: boolean }>(
      sql`
        SELECT provider, enabled, (api_key_encrypted IS NOT NULL) AS configured
        FROM app.ai_providers
      `,
    );
    const habilitados = rows.filter((r) => r.enabled && r.configured);
    return {
      name: "ai_providers",
      status: habilitados.length > 0 ? "ok" : "degraded",
      detail:
        habilitados.length > 0
          ? `habilitados: ${habilitados.map((p) => p.provider).join(", ")}`
          : "ningun proveedor configurado (Genie no funciona)",
      durationMs: Date.now() - start,
    };
  } catch {
    return { name: "ai_providers", status: "error", durationMs: Date.now() - start };
  }
}

async function checkMigrations(): Promise<Check> {
  const start = Date.now();
  try {
    const rows = await db.execute<{ count: number; last: string }>(
      sql`SELECT COUNT(*)::int AS count, MAX(version) AS last FROM public.schema_migrations`,
    );
    return {
      name: "migrations",
      status: "ok",
      detail: `${rows[0]?.count ?? 0} aplicadas, ultima=${rows[0]?.last ?? "none"}`,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      name: "migrations",
      status: "error",
      detail: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const deep = url.searchParams.get("deep") === "1";

  // Minimo: solo DB ping (para load balancers)
  const dbCheck = await checkDb();
  if (!deep) {
    return NextResponse.json(
      {
        status: dbCheck.status === "ok" ? "ok" : "error",
        service: "aibenchef-web",
        timestamp: new Date().toISOString(),
        started_at: STARTED_AT,
        uptime_seconds: Math.round((Date.now() - new Date(STARTED_AT).getTime()) / 1000),
        git_sha: process.env.GIT_SHA?.slice(0, 7) ?? null,
      },
      { status: dbCheck.status === "ok" ? 200 : 503 },
    );
  }

  // Deep: corre todos los checks en paralelo (~200ms)
  const checks = await Promise.all([
    Promise.resolve(dbCheck),
    checkMigrations(),
    checkMvFreshness(),
    checkAiProviders(),
  ]);

  const anyError = checks.some((c) => c.status === "error");
  const anyDegraded = checks.some((c) => c.status === "degraded");
  const overall: "ok" | "degraded" | "error" = anyError
    ? "error"
    : anyDegraded
      ? "degraded"
      : "ok";

  return NextResponse.json(
    {
      status: overall,
      service: "aibenchef-web",
      timestamp: new Date().toISOString(),
      started_at: STARTED_AT,
      uptime_seconds: Math.round((Date.now() - new Date(STARTED_AT).getTime()) / 1000),
      git_sha: process.env.GIT_SHA?.slice(0, 7) ?? null,
      node_env: process.env.NODE_ENV,
      checks,
    },
    { status: overall === "error" ? 503 : 200 },
  );
}
