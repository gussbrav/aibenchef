/**
 * GET  /api/v1/governance/glossary  — lista publica con filtros.
 * PUT  /api/v1/governance/glossary  — upsert (admin only).
 */

import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";
import {
  type GlossaryCategory,
  getGlossary,
  recordAuditEvent,
} from "@/lib/domains/governance";
import { requireAdmin } from "@/lib/domains/users";
import { handleRoute, UnauthorizedError, ValidationError } from "@/lib/domains/shared";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = new Set<GlossaryCategory>([
  "financial",
  "regulatory",
  "ratio",
  "calculated",
  "dimension",
  "metric",
  "general",
]);

const upsertBody = z.object({
  schemaName: z.string().min(1).max(64),
  tableName: z.string().min(1).max(128),
  columnName: z.string().max(128).nullable().optional(),
  displayName: z.string().min(1).max(256),
  description: z.string().min(1).max(4096),
  ownerEmail: z.string().email().nullable().optional(),
  category: z
    .enum(["financial", "regulatory", "ratio", "calculated", "dimension", "metric", "general"])
    .optional(),
  appliesTo: z.array(z.string()).optional(),
  formula: z.string().max(2048).nullable().optional(),
  exampleUsage: z.string().max(2048).nullable().optional(),
  source: z.string().max(256).nullable().optional(),
});

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});

    const url = new URL(req.url);
    const categoryParam = url.searchParams.get("category");
    const category = categoryParam
      ? (categoryParam
          .split(",")
          .filter((c) => VALID_CATEGORIES.has(c as GlossaryCategory)) as GlossaryCategory[])
      : undefined;

    const filter = {
      schemaName: url.searchParams.get("schema") ?? undefined,
      tableName: url.searchParams.get("table") ?? undefined,
      columnName: url.searchParams.get("column") ?? undefined,
      category,
      search: url.searchParams.get("q") ?? undefined,
      limit: url.searchParams.get("limit")
        ? Number(url.searchParams.get("limit"))
        : undefined,
      offset: url.searchParams.get("offset")
        ? Number(url.searchParams.get("offset"))
        : undefined,
    };

    const glossary = getGlossary();
    const [rows, total] = await Promise.all([
      glossary.list(filter),
      glossary.count(filter),
    ]);
    return { rows, total };
  });
}

export async function PUT(req: NextRequest) {
  return handleRoute(async () => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new UnauthorizedError("Sesion requerida", {});
    await requireAdmin(session.user.id);

    const json = await req.json();
    const parsed = upsertBody.safeParse(json);
    if (!parsed.success) {
      throw new ValidationError("Body invalido", {
        issues: parsed.error.flatten().fieldErrors,
      });
    }

    const glossary = getGlossary();
    const entry = await glossary.upsert(parsed.data, session.user.id);

    // Audit: cambio en glossary
    await recordAuditEvent({
      category: "governance",
      action: "glossary_upsert",
      severity: "info",
      actorId: session.user.id,
      actorEmail: session.user.email,
      resource: `${entry.schemaName}.${entry.tableName}${entry.columnName ? "." + entry.columnName : ""}`,
      metadata: { id: entry.id, category: entry.category },
    });

    return entry;
  });
}
